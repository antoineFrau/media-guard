/**
 * Captures YouTube video audio via HTMLMediaElement.captureStream (no picker needed).
 * Firefox doesn't support tab audio with getDisplayMedia; captureStream works on the page's video element.
 */
(function () {
  'use strict';

  const SAMPLE_RATE_24K = 24000;
  const SAMPLE_RATE_16K = 16000;
  const WS_URL_ELEVENLABS = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
  const CHUNK_SIZE = 1024;
  const MIN_DURATION_FOR_ANALYZE = 10;

  function float32ToPcmBase64(float32) {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const bytes = new Uint8Array(int16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function resampleTo24k(input, fromRate) {
    if (fromRate === SAMPLE_RATE_24K) return input;
    const ratio = fromRate / SAMPLE_RATE_24K;
    const outLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const srcIndex = i * ratio;
      const j = Math.floor(srcIndex);
      const frac = srcIndex - j;
      output[i] = input[j] * (1 - frac) + (input[j + 1] ?? input[j]) * frac;
    }
    return output;
  }

  function resampleTo16k(input, fromRate) {
    if (fromRate === SAMPLE_RATE_16K) return input;
    const ratio = fromRate / SAMPLE_RATE_16K;
    const outLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const srcIndex = i * ratio;
      const j = Math.floor(srcIndex);
      const frac = srcIndex - j;
      output[i] = input[j] * (1 - frac) + (input[j + 1] ?? input[j]) * frac;
    }
    return output;
  }

  let _activeCleanup = null;
  const LOG = (...args) => console.log('[MediaGuard]', ...args);

  window.MediaGuardCapture = {
    stopCapture() {
      if (typeof _activeCleanup === 'function') _activeCleanup();
    },
    async startCapture(options) {
      const { videoId, apiBaseUrl, mistralKey, elevenlabsKey, sttProvider, onStatus, onTranscript, onComplete, onError, onCaptureStart, videoElement } = options;
      const useMistral = sttProvider === 'mistral';
      LOG('startCapture', { videoId, sttProvider: sttProvider || 'elevenlabs', useMistral });

      if (!mistralKey) {
        onError('Configure Mistral API key in extension settings.');
        return;
      }

      const video = videoElement || document.querySelector('#movie_player video') || document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (!video) {
        onError('Video element not found. Ensure the video is loaded.');
        return;
      }
      if (video.paused) {
        onError('Play the video first, then click Capture audio.');
        return;
      }

      let stream = null;
      let audioContext = null;
      let source = null;
      let processor = null;
      let ws = null;
      const segments = [];
      let words = [];
      let lastPartialText = '';
      let sessionStartTime = 0;
      let videoStartTime = 0; // video.currentTime when capture started (for offsetting STT timestamps)
      let analyzeTriggered = false;

      let analyzeCheckInterval = null;
      let mistralDoneResolve = null;
      const mistralDonePromise = useMistral
        ? new Promise((resolve) => { mistralDoneResolve = resolve; })
        : null;

      const cleanup = () => {
        LOG('cleanup called');
        _activeCleanup = null;
        if (analyzeCheckInterval) {
          clearInterval(analyzeCheckInterval);
          analyzeCheckInterval = null;
        }
        if (processor && source && audioContext) {
          try {
            processor.disconnect();
            source.disconnect();
            // Firefox workaround (bug 1178751): captureStream() steals the video's AudioSink.
            // When we stop, route the capture stream directly to speakers so audio continues.
            source.connect(audioContext.destination);
          } catch (_) {}
        } else if (processor && source) {
          try { processor.disconnect(); source.disconnect(); } catch (_) {}
        }
        // Do NOT close audioContext: we keep source->destination so video audio keeps playing.
        if (stream) stream = null;
        if (ws && ws.readyState === WebSocket.OPEN) {
          if (useMistral) ws.send(JSON.stringify({ type: 'end' }));
          ws.close();
        }
        if (video) {
          const wasPlaying = !video.paused;
          const ct = video.currentTime;
          video.pause();
          video.currentTime = ct;
          if (wasPlaying) {
            setTimeout(() => { video.play().catch(() => {}); }, 0);
          }
        }
      };
      _activeCleanup = cleanup;

      try {
        onStatus('Capturing from video element…');
        const captureFn = video.captureStream || video.mozCaptureStream || video.mozCaptureMediaStream;
        if (typeof captureFn !== 'function') {
          onError('Audio capture not supported in this browser. Try Chrome, or use the STT app at localhost:8000 with Tab + ElevenLabs or Mistral.');
          return;
        }
        stream = captureFn.call(video);
        const audioTracks = stream.getAudioTracks();
        if (!audioTracks.length) {
          onError('Video has no audio track. Try playing the video first, then click Capture.');
          cleanup();
          return;
        }

        if (useMistral) {
          if (!mistralKey) {
            onError('Mistral API key required for Mistral STT. Configure in extension settings.');
            return;
          }
          const wsBase = apiBaseUrl.replace(/^http/, 'ws');
          ws = new WebSocket(`${wsBase}/stt/mistral-stream?api_key=${encodeURIComponent(mistralKey)}`);
          sessionStartTime = Date.now() / 1000;
          await new Promise((resolve, reject) => {
            ws.onopen = () => { LOG('Mistral WebSocket open'); onStatus('Mistral connected. Capturing…'); resolve(); };
            ws.onerror = () => { LOG('Mistral WebSocket error'); reject(new Error('WebSocket error')); };
            ws.onclose = () => LOG('Mistral WebSocket closed');
          });
        } else {
          onStatus('Getting ElevenLabs token…');
          const tokenRes = elevenlabsKey
            ? await fetch(`${apiBaseUrl}/stt/elevenlabs-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: elevenlabsKey })
              })
            : await fetch(`${apiBaseUrl}/stt/elevenlabs-token`);
          const tokenData = await tokenRes.json();
          if (!tokenRes.ok) throw new Error(tokenData.message || tokenData.reason || 'Token failed');

          const token = tokenData.token;
          const params = new URLSearchParams({
            model_id: 'scribe_v2_realtime',
            audio_format: 'pcm_24000',
            include_timestamps: 'true',
            commit_strategy: 'vad'
          });
          params.set('token', token);
          ws = new WebSocket(`${WS_URL_ELEVENLABS}?${params.toString()}`);
          sessionStartTime = Date.now() / 1000;

          await new Promise((resolve, reject) => {
            ws.onopen = () => { LOG('ElevenLabs WebSocket open'); onStatus('ElevenLabs connected. Capturing…'); resolve(); };
            ws.onerror = () => { LOG('ElevenLabs WebSocket error'); reject(new Error('WebSocket error')); };
            ws.onclose = () => LOG('ElevenLabs WebSocket closed');
          });
        }

        audioContext = new AudioContext();
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        source = audioContext.createMediaStreamSource(stream);
        processor = audioContext.createScriptProcessor(CHUNK_SIZE, 1, 1);
        const inputRate = audioContext.sampleRate;

        processor.onaudioprocess = (e) => {
          const raw = e.inputBuffer.getChannelData(0);
          const out = e.outputBuffer.getChannelData(0);
          out.set(raw);
          if (++audioChunkCount === 1) LOG('first audio chunk sent to', useMistral ? 'Mistral' : 'ElevenLabs');
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          if (useMistral) {
            const chunk = resampleTo16k(new Float32Array(raw), inputRate);
            ws.send(JSON.stringify({ type: 'audio', data: float32ToPcmBase64(chunk) }));
          } else {
            const chunk = resampleTo24k(new Float32Array(raw), inputRate);
            ws.send(JSON.stringify({
              message_type: 'input_audio_chunk',
              audio_base_64: float32ToPcmBase64(chunk),
              sample_rate: SAMPLE_RATE_24K,
              commit: false
            }));
          }
        };

        let audioChunkCount = 0;
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            const msgType = useMistral ? msg.type : msg.message_type;
            if (!msgType || (msgType !== 'partial' && msgType !== 'partial_transcript' && msgType !== 'committed' && msgType !== 'committed_transcript' && msgType !== 'committed_transcript_with_timestamps')) {
              LOG('ws message', msgType || Object.keys(msg)[0], msg);
            }
            if (useMistral) {
              switch (msg.type) {
                case 'partial':
                  if (msg.text !== undefined) {
                    lastPartialText += msg.text;
                    LOG('partial delta:', JSON.stringify(msg.text?.slice(-40)), '-> lastPartialText length:', lastPartialText.length);
                  }
                  if (onTranscript) onTranscript({ type: 'partial', text: msg.text || '' });
                  break;
                case 'committed':
                  if (msg.text) {
                    LOG('committed:', msg.text, '-> segments+', 1, 'words+', (msg.words?.length || msg.text.split(/\s+/).length));
                    lastPartialText = '';
                  }
                  if (msg.words && msg.words.length) {
                    const rawStart = msg.words[0].start ?? 0;
                    const rawEnd = msg.words[msg.words.length - 1].end ?? rawStart + 1;
                    segments.push({ text: msg.text || '', start: videoStartTime + rawStart, end: videoStartTime + rawEnd });
                    words = words.concat(msg.words.map((w) => w.text).filter(Boolean));
                  } else {
                    words = words.concat((msg.text || '').split(/\s+/).filter(Boolean));
                  }
                  LOG('state after committed: segments=', segments.length, 'words=', words.length);
                  if (onTranscript) {
                    const w = msg.words || [];
                    const rawStart = w[0]?.start ?? 0;
                    const rawEnd = w[w.length - 1]?.end ?? rawStart + 1;
                    onTranscript({ type: 'committed', text: msg.text, start: videoStartTime + rawStart, end: videoStartTime + rawEnd, words: w });
                  }
                  break;
                case 'done':
                  LOG('Mistral transcription.done — flush complete');
                  if (mistralDoneResolve) { mistralDoneResolve(); mistralDoneResolve = null; }
                  break;
                case 'error':
                  onStatus('Mistral: ' + (msg.error || 'Unknown'));
                  break;
              }
            } else {
              switch (msg.message_type) {
                case 'partial_transcript':
                  if (msg.text) {
                    lastPartialText = msg.text;
                    LOG('partial:', msg.text, '-> lastPartialText length:', lastPartialText.length);
                  }
                  if (onTranscript) onTranscript({ type: 'partial', text: msg.text || '' });
                  break;
                case 'committed_transcript':
                  if (msg.text) {
                    LOG('committed_transcript:', msg.text);
                    lastPartialText = '';
                  }
                  words = words.concat((msg.text || '').split(/\s+/).filter(Boolean));
                  LOG('state after committed_transcript: words=', words.length);
                  if (onTranscript) onTranscript({ type: 'committed', text: msg.text, start: 0, end: 0, words: null });
                  break;
                case 'committed_transcript_with_timestamps':
                  if (msg.text) {
                    LOG('committed_with_ts:', msg.text);
                    lastPartialText = '';
                  }
                  if (msg.words && msg.words.length) {
                    const rawStart = msg.words[0].start ?? 0;
                    const rawEnd = msg.words[msg.words.length - 1].end ?? rawStart + 1;
                    segments.push({ text: msg.text || '', start: videoStartTime + rawStart, end: videoStartTime + rawEnd });
                    words = words.concat(msg.words.map((w) => w.text).filter(Boolean));
                  } else {
                    words = words.concat((msg.text || '').split(/\s+/).filter(Boolean));
                  }
                  LOG('state after committed_with_ts: segments=', segments.length, 'words=', words.length);
                  if (onTranscript) {
                    const w = msg.words || [];
                    const rawStart = w[0]?.start ?? 0;
                    const rawEnd = w[w.length - 1]?.end ?? rawStart + 1;
                    onTranscript({ type: 'committed', text: msg.text, start: videoStartTime + rawStart, end: videoStartTime + rawEnd, words: w });
                  }
                  break;
                case 'error':
                case 'auth_error':
                case 'quota_exceeded':
                case 'rate_limited':
                  onStatus('ElevenLabs: ' + (msg.error || 'Unknown'));
                  break;
              }
            }
          } catch (_) {}
        };

        async function runAnalyze(fromStop = false) {
          LOG('runAnalyze called', { fromStop, segments: segments.length, words: words.length, lastPartialLen: lastPartialText.length });
          onStatus(fromStop ? 'Stopped. Sending to Mistral…' : `${MIN_DURATION_FOR_ANALYZE}s reached. Sending to Mistral…`);
          const elapsed = sessionStartTime > 0 ? Math.max(1, (Date.now() / 1000) - sessionStartTime) : MIN_DURATION_FOR_ANALYZE;
          const partialText = lastPartialText.trim();
          const fromWords = words.join(' ').trim();
          const fullText = (
            segments.length > 0
              ? [...segments.map((s) => s.text), partialText]
              : [fromWords, partialText]
          ).filter(Boolean).join(' ').trim();
          let transcript;
          if (segments.length > 0) {
            transcript = segments.map((s) => ({ text: s.text, start: s.start, end: s.end }));
            if (partialText.trim()) {
              const lastEnd = transcript[transcript.length - 1].end;
              transcript.push({
                text: partialText.trim(),
                start: lastEnd,
                end: videoStartTime + elapsed
              });
            }
          } else {
            transcript = fullText ? [{ text: fullText, start: videoStartTime, end: videoStartTime + elapsed }] : [];
          }
          const firstStart = transcript.length > 0 ? transcript[0].start : 0;
          const lastEnd = transcript.length > 0 ? transcript[transcript.length - 1].end : 0;
          LOG('runAnalyze transcript', { videoStart: firstStart.toFixed(1), videoEnd: lastEnd.toFixed(1), segments: transcript.length, elapsed, textLen: fullText.length, textPreview: fullText.slice(0, 120) });
          if (!fullText) {
            onStatus('No transcript yet. Keep recording…');
            analyzeTriggered = false;
            return;
          }
          try {
            const url = `${apiBaseUrl}/analyze`;
            LOG('fetch POST', url);
            const res = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Mistral-API-Key': mistralKey
              },
              body: JSON.stringify({
                video_id: videoId,
                transcript,
                mistral_api_key: mistralKey,
                transcript_source: useMistral ? 'mistral' : 'elevenlabs'
              })
            });
            const data = await res.json();
            LOG('analyze response', { status: res.status, ok: res.ok });
            if (!res.ok) throw new Error(data.reason || data.message || res.status);
            if (fromStop) {
              LOG('analyze success (stop), calling cleanup + onComplete');
              cleanup();
              onComplete(data);
            } else {
              LOG('analyze success (continue), calling onComplete without cleanup');
              onComplete(data, { continueRecording: true });
            }
          } catch (err) {
            LOG('analyze error:', err.message);
            onStatus('Analysis failed: ' + (err.message || err));
            analyzeTriggered = false;
          }
        }

        videoStartTime = video.currentTime;
        LOG('capture started at video time', videoStartTime.toFixed(1));
        source.connect(processor);
        processor.connect(audioContext.destination);

        analyzeCheckInterval = setInterval(() => {
          const elapsed = sessionStartTime > 0 ? (Date.now() / 1000) - sessionStartTime : 0;
          const hasTranscript = segments.length > 0 || words.join(' ').trim() || lastPartialText.trim();
          if (elapsed >= MIN_DURATION_FOR_ANALYZE && hasTranscript && !analyzeTriggered) {
            LOG('interval: triggering runAnalyze', { elapsed: Math.round(elapsed), hasTranscript });
            analyzeTriggered = true;
            runAnalyze();
          } else if (elapsed > 0 && elapsed < MIN_DURATION_FOR_ANALYZE && hasTranscript) {
            onStatus(`${Math.round(elapsed)}s captured. Auto-analyze at ${MIN_DURATION_FOR_ANALYZE}s…`);
            if (Math.round(elapsed) % 5 === 0) {
              LOG('interval tick', { elapsed: Math.round(elapsed), segments: segments.length, words: words.length, lastPartialLen: lastPartialText.length });
            }
          }
        }, 1000);

        async function stopAndAnalyze() {
          const hasTranscript = segments.length > 0 || words.join(' ').trim() || lastPartialText.trim();
          LOG('stopAndAnalyze', { segments: segments.length, words: words.length, lastPartial: lastPartialText?.slice(0, 80), lastPartialLen: lastPartialText.length, hasTranscript, analyzeTriggered });
          if (hasTranscript) {
            if (useMistral && ws && ws.readyState === WebSocket.OPEN) {
              onStatus('Flushing transcription…');
              ws.send(JSON.stringify({ type: 'end' }));
              await Promise.race([
                mistralDonePromise || Promise.resolve(),
                new Promise((r) => setTimeout(r, 3000))
              ]);
            }
            await runAnalyze(true);
          } else {
            onStatus('No transcript captured. Record longer before stopping.');
          }
          if (_activeCleanup) cleanup();
        }

        if (typeof onCaptureStart === 'function') onCaptureStart(stopAndAnalyze);
      } catch (err) {
        cleanup();
        onError(err.message || 'Capture failed');
      }
    }
  };
})();
