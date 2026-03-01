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
  const MIN_DURATION_FOR_ANALYZE = 60;

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

  window.MediaGuardCapture = {
    stopCapture() {
      if (typeof _activeCleanup === 'function') _activeCleanup();
    },
    async startCapture(options) {
      const { videoId, apiBaseUrl, mistralKey, elevenlabsKey, sttProvider, onStatus, onTranscript, onComplete, onError, onCaptureStart, videoElement } = options;
      const useMistral = sttProvider === 'mistral';

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
      let sessionStartTime = 0;
      let analyzeTriggered = false;

      const cleanup = () => {
        _activeCleanup = null;
        if (processor && source) try { processor.disconnect(); source.disconnect(); } catch (_) {}
        if (audioContext) try { audioContext.close(); } catch (_) {}
        if (stream) stream.getTracks().forEach((t) => t.stop());
        if (ws && ws.readyState === WebSocket.OPEN) {
          if (useMistral) ws.send(JSON.stringify({ type: 'end' }));
          ws.close();
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
            ws.onopen = () => { onStatus('Mistral connected. Capturing…'); resolve(); };
            ws.onerror = () => reject(new Error('WebSocket error'));
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
            ws.onopen = () => { onStatus('ElevenLabs connected. Capturing…'); resolve(); };
            ws.onerror = () => reject(new Error('WebSocket error'));
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
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const raw = e.inputBuffer.getChannelData(0);
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

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (useMistral) {
              switch (msg.type) {
                case 'partial':
                  if (onTranscript) onTranscript({ type: 'partial', text: msg.text || '' });
                  break;
                case 'committed':
                  if (msg.words && msg.words.length) {
                    const start = msg.words[0].start ?? 0;
                    const end = msg.words[msg.words.length - 1].end ?? start + 1;
                    segments.push({ text: msg.text || '', start, end });
                    words = words.concat(msg.words.map((w) => w.text).filter(Boolean));
                  } else {
                    words = words.concat((msg.text || '').split(/\s+/).filter(Boolean));
                  }
                  if (onTranscript) {
                    const w = msg.words || [];
                    onTranscript({ type: 'committed', text: msg.text, start: w[0]?.start ?? 0, end: w[w.length - 1]?.end ?? 0, words: w });
                  }
                  const dur = segments.length ? segments[segments.length - 1].end : 0;
                  if (dur >= MIN_DURATION_FOR_ANALYZE && !analyzeTriggered) {
                    analyzeTriggered = true;
                    runAnalyze();
                  } else if (dur > 0 && dur < MIN_DURATION_FOR_ANALYZE) {
                    onStatus(`${Math.round(dur)}s captured. Auto-analyze at 60s…`);
                  }
                  break;
                case 'error':
                  onStatus('Mistral: ' + (msg.error || 'Unknown'));
                  break;
              }
            } else {
              switch (msg.message_type) {
                case 'partial_transcript':
                  if (onTranscript) onTranscript({ type: 'partial', text: msg.text || '' });
                  break;
                case 'committed_transcript':
                  words = words.concat((msg.text || '').split(/\s+/).filter(Boolean));
                  if (onTranscript) onTranscript({ type: 'committed', text: msg.text, start: 0, end: 0, words: null });
                  break;
                case 'committed_transcript_with_timestamps':
                  if (msg.words && msg.words.length) {
                    const start = msg.words[0].start ?? 0;
                    const end = msg.words[msg.words.length - 1].end ?? start + 1;
                    segments.push({ text: msg.text || '', start, end });
                    words = words.concat(msg.words.map((w) => w.text).filter(Boolean));
                  } else {
                    words = words.concat((msg.text || '').split(/\s+/).filter(Boolean));
                  }
                  if (onTranscript) {
                    const w = msg.words || [];
                    onTranscript({ type: 'committed', text: msg.text, start: w[0]?.start ?? 0, end: w[w.length - 1]?.end ?? 0, words: w });
                  }
                  const dur = segments.length ? segments[segments.length - 1].end : 0;
                  if (dur >= MIN_DURATION_FOR_ANALYZE && !analyzeTriggered) {
                    analyzeTriggered = true;
                    runAnalyze();
                  } else if (dur > 0 && dur < MIN_DURATION_FOR_ANALYZE) {
                    onStatus(`${Math.round(dur)}s captured. Auto-analyze at 60s…`);
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

        async function runAnalyze() {
          onStatus('1 min reached. Sending to Mistral…');
          const transcript = segments.length > 0
            ? segments
            : [{ text: words.join(' '), start: 0, end: MIN_DURATION_FOR_ANALYZE }];
          const text = transcript.map((s) => s.text).join(' ').trim();
          if (!text) {
            onStatus('No transcript yet. Keep recording…');
            analyzeTriggered = false;
            return;
          }
          try {
            const res = await fetch(`${apiBaseUrl}/analyze`, {
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
            if (!res.ok) throw new Error(data.reason || data.message || res.status);
            cleanup();
            onComplete(data);
          } catch (err) {
            onStatus('Analysis failed: ' + (err.message || err));
            analyzeTriggered = false;
          }
        }

        source.connect(processor);
        processor.connect(audioContext.destination);
        if (typeof onCaptureStart === 'function') onCaptureStart(cleanup);
      } catch (err) {
        cleanup();
        onError(err.message || 'Capture failed');
      }
    }
  };
})();
