import { ElevenLabsClient } from "./elevenlabs-client.js";

const WEIGHTS_URL =
  "https://huggingface.co/efficient-nlp/stt-1b-en_fr-quantized/resolve/main/model-q4k.gguf";
const MIMI_URL =
  "https://huggingface.co/efficient-nlp/stt-1b-en_fr-quantized/resolve/main/mimi-pytorch-e351c8d8@125.safetensors";
const TOKENIZER_URL =
  "https://huggingface.co/efficient-nlp/stt-1b-en_fr-quantized/resolve/main/tokenizer_en_fr_audio_8000.json";
const CONFIG_URL =
  "https://huggingface.co/efficient-nlp/stt-1b-en_fr-quantized/resolve/main/config.json";

const CHUNK_DURATION_SEC = 1024 / 24000;

const moshiWorker = new Worker("./js/moshi-worker.js", { type: "module" });
let isRecording = false;
let audioStream = null;
let audioContext = null;
let processor = null;
let source = null;
let modelInitialized = false;
let pendingStart = false;
let audioChunksProcessed = 0;
let sessionStartTime = 0;
let transcriptWords = [];
let transcriptSegments = [];
let transcriptStartTime = 0;
let elevenlabsClient = null;
let analyzeTriggered = false; // Auto-analyze only once after 1 min

// Diagnostics
let diagChunksSent = 0;
let diagPartialCount = 0;
let diagCommittedCount = 0;
let diagStreamAudioTracks = 0;
let diagInterval = null;

const statusEl = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");
const speechBtn = document.getElementById("speech-btn");
const analyzeBtn = document.getElementById("analyze-btn");
const segmentsRoot = document.getElementById("segments-root");

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function updateDiagnostics() {
  const el = document.getElementById("diagnostics");
  const out = document.getElementById("diagnostics-output");
  if (!el || !out) return;
  const elapsed = sessionStartTime ? (Date.now() - sessionStartTime) / 1000 : 0;
  const chunksPerSec = elapsed > 0 ? (diagChunksSent / elapsed).toFixed(1) : "0";
  const audioDuration = (1024 / 24000) * diagChunksSent;
  out.textContent = [
    `Audio stream: ${diagStreamAudioTracks} track(s)${diagStreamAudioTracks === 0 ? " ⚠️ NO AUDIO!" : ""}`,
    `Chunks sent to ElevenLabs: ${diagChunksSent} (~${chunksPerSec}/s, ~${audioDuration.toFixed(1)}s of audio)`,
    `ElevenLabs events: ${diagPartialCount} partial, ${diagCommittedCount} committed`,
    `Transcript duration: ${getTranscriptDuration().toFixed(1)}s`,
    ``,
    diagStreamAudioTracks === 0 ? "→ For Tab: ensure 'Share tab audio' is checked in the picker." : "",
    diagChunksSent === 0 && isRecording ? "→ No chunks sent. Check audio stream." : "",
    diagCommittedCount === 0 && diagChunksSent > 100 ? "→ Audio sent but no transcript. Silence or ElevenLabs issue?" : "",
  ].filter(Boolean).join("\n");
  el.hidden = !isRecording;
}

function getSource() {
  const r = document.querySelector('input[name="source"]:checked');
  return r ? r.value : "mic";
}

function getProvider() {
  const r = document.querySelector('input[name="provider"]:checked');
  return r ? r.value : "local";
}

function getApiUrl() {
  return (document.getElementById("api-url")?.value || "").trim() || "http://localhost:3000";
}

function getVideoId() {
  const v = (document.getElementById("video-id")?.value || "").trim();
  return v || `stt-${Date.now()}`;
}

/** Duration of transcribed audio from ElevenLabs segments (seconds). */
function getTranscriptDuration() {
  if (!transcriptSegments || transcriptSegments.length === 0) return 0;
  const last = transcriptSegments[transcriptSegments.length - 1];
  return last?.end ?? 0;
}

async function triggerAnalyze() {
  if (analyzeTriggered) return;
  const mistralKey = (document.getElementById("mistral-key")?.value || "").trim();
  if (!mistralKey) {
    setStatus("1 min reached. Enter Mistral API key to auto-analyze, or click Analyze manually.");
    return;
  }
  analyzeTriggered = true;
  const text = transcriptWords.join(" ").trim();
  if (!text) {
    setStatus("1 min reached but no transcript yet. Waiting for more…");
    analyzeTriggered = false;
    return;
  }
  const transcript =
    transcriptSegments.length > 0
      ? transcriptSegments
      : [{ text, start: 0, end: 60 }];

  const apiUrl = getApiUrl();
  const videoId = getVideoId();

  setStatus("1 min reached. Sending to Mistral…");

  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_id: videoId,
        transcript,
        mistral_api_key: mistralKey,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setStatus("Auto-analyze failed: " + (data.reason || data.message || res.status));
      analyzeTriggered = false;
      return;
    }
    renderSegments(data.alerts || [], data.fact_checks || []);
    setStatus(`Auto-analyzed (1 min). Stored for video ${videoId}. ${(data.alerts?.length || 0) + (data.fact_checks?.length || 0)} segments. Still recording…`);
  } catch (err) {
    setStatus("Auto-analyze error: " + err.message);
    analyzeTriggered = false;
  }
}

async function getAudioStream() {
  const src = getSource();
  if (src === "tab") {
    const audioConstraints = { echoCancellation: false, noiseSuppression: false };
    if (navigator.mediaDevices?.getSupportedConstraints?.().suppressLocalAudioPlayback) {
      audioConstraints.suppressLocalAudioPlayback = false;
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: audioConstraints,
    });
    diagStreamAudioTracks = stream.getAudioTracks().length;
    if (diagStreamAudioTracks === 0) {
      console.warn("[STT] Tab share has NO audio tracks — check 'Share tab audio' in the picker!");
    }
    return stream;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  diagStreamAudioTracks = stream.getAudioTracks().length;
  return stream;
}

function resampleTo24k(input, fromRate) {
  if (fromRate === 24000) return input;
  const ratio = fromRate / 24000;
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

async function startAudio() {
  const stream = await getAudioStream();
  audioStream = stream;

  audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
  source = audioContext.createMediaStreamSource(stream);
  processor = audioContext.createScriptProcessor(1024, 1, 1);
  const inputRate = audioContext.sampleRate;

  processor.onaudioprocess = (event) => {
    if (!isRecording) return;
    const inputData = event.inputBuffer.getChannelData(0);
    const chunk = new Float32Array(inputData);

    if (getProvider() === "local") {
      if (!modelInitialized) return;
      const resampled = inputRate === 24000 ? chunk : resampleTo24k(chunk, inputRate);
      moshiWorker.postMessage({ command: "process_audio", audioData: resampled }, [resampled.buffer]);
    } else {
      if (elevenlabsClient) {
        const toSend = inputRate === 24000 ? chunk : resampleTo24k(chunk, inputRate);
        elevenlabsClient.sendAudio(toSend);
        diagChunksSent++;
      }
      audioChunksProcessed++;
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
}

function stopAudio() {
  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (source) {
    source.disconnect();
    source = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;
  }
}

function initializeModel() {
  if (modelInitialized) return;
  speechBtn.disabled = true;
  setStatus("Loading model (~950 MB)…");
  moshiWorker.postMessage({
    command: "initialize",
    weightsURL: WEIGHTS_URL,
    mimiURL: MIMI_URL,
    tokenizerURL: TOKENIZER_URL,
    configURL: CONFIG_URL,
  });
}

moshiWorker.addEventListener("message", (event) => {
  const d = event.data;
  if (d.status === "model_ready") {
    modelInitialized = true;
    setStatus("Model ready. Click Start transcription.");
    speechBtn.disabled = false;
    speechBtn.classList.remove("btn-primary");
    speechBtn.classList.add("btn-primary");
    if (pendingStart) {
      pendingStart = false;
      startRecording();
    }
  } else if (d.status === "streaming") {
    transcriptWords.push(d.word);
    const text = transcriptWords.join(" ");
    transcriptEl.textContent = text;
    transcriptEl.style.whiteSpace = "pre-wrap";
  } else if (d.status === "chunk_processed") {
    audioChunksProcessed++;
  } else if (d.status === "loading") {
    setStatus(d.message || "Loading…");
  } else if (d.error) {
    setStatus("Error: " + d.error);
    pendingStart = false;
  }
});

async function startRecording() {
  try {
    setStatus("Requesting audio access…");
    await startAudio();

    audioChunksProcessed = 0;
    sessionStartTime = Date.now();
    transcriptStartTime = Date.now() / 1000;
    transcriptWords = [];
    transcriptSegments = [];
    analyzeTriggered = false;
    diagChunksSent = 0;
    diagPartialCount = 0;
    diagCommittedCount = 0;
    diagStreamAudioTracks = 0;
    transcriptEl.textContent = "";
    isRecording = true;
    document.querySelectorAll('input[name="provider"]').forEach((el) => (el.disabled = true));
    document.querySelectorAll('input[name="source"]').forEach((el) => (el.disabled = true));
    speechBtn.textContent = "Stop transcription";
    speechBtn.className = "btn-stop";
    analyzeBtn.disabled = true;
    segmentsRoot.hidden = true;
    segmentsRoot.innerHTML = "";

    if (getProvider() === "elevenlabs") {
      const elevenlabsKey = (document.getElementById("elevenlabs-key")?.value || "").trim();
      elevenlabsClient = new ElevenLabsClient({
        apiUrl: getApiUrl(),
        elevenlabsApiKey: elevenlabsKey || undefined,
      });
      elevenlabsClient.onStatus = setStatus;
      elevenlabsClient.onTranscript = (ev) => {
        if (ev.type === "partial") diagPartialCount++;
        if (ev.type === "committed") diagCommittedCount++;
        transcriptWords = elevenlabsClient.getTranscript().split(/\s+/).filter(Boolean);
        transcriptSegments = elevenlabsClient.getSegments();
        const partial = ev.type === "partial" && ev.text ? " " + ev.text : "";
        transcriptEl.textContent = (transcriptWords.join(" ") + partial).trim();
        transcriptEl.style.whiteSpace = "pre-wrap";
        // Store transcript as it arrives; auto-analyze after at least 1 minute
        const dur = getTranscriptDuration();
        if (ev.type === "committed" && dur >= 60 && !analyzeTriggered) {
          triggerAnalyze();
        } else if (ev.type === "committed" && dur > 0 && dur < 60) {
          setStatus(`${Math.round(dur)}s transcribed. Auto-analyze at 60s…`);
        }
      };
      await elevenlabsClient.start();
      setStatus("Listening…");
      diagInterval = setInterval(updateDiagnostics, 500);
    } else {
      moshiWorker.postMessage({ command: "start_stream" });
      setStatus("Listening…");
    }
  } catch (err) {
    setStatus("Error: " + err.message);
    isRecording = false;
    stopAudio();
    document.querySelectorAll('input[name="provider"]').forEach((el) => (el.disabled = false));
    document.querySelectorAll('input[name="source"]').forEach((el) => (el.disabled = false));
    speechBtn.textContent = "Start transcription";
    speechBtn.className = "btn-primary";
    analyzeBtn.disabled = false;
  }
}

function stopRecording() {
  if (diagInterval) {
    clearInterval(diagInterval);
    diagInterval = null;
  }
  stopAudio();
  if (getProvider() === "elevenlabs" && elevenlabsClient) {
    elevenlabsClient.stop();
    transcriptWords = elevenlabsClient.getTranscript().split(/\s+/).filter(Boolean);
    transcriptSegments = elevenlabsClient.getSegments();
    elevenlabsClient = null;
  } else {
    moshiWorker.postMessage({ command: "stop_stream" });
    const duration = audioChunksProcessed * CHUNK_DURATION_SEC;
    transcriptSegments = transcriptWords.length
      ? [{ text: transcriptWords.join(" "), start: 0, end: Math.max(duration, 1) }]
      : [];
  }
  isRecording = false;
  document.querySelectorAll('input[name="provider"]').forEach((el) => (el.disabled = false));
  document.querySelectorAll('input[name="source"]').forEach((el) => (el.disabled = false));
  speechBtn.textContent = "Start transcription";
  speechBtn.className = "btn-primary";
  analyzeBtn.disabled = false;
  const duration = getProvider() === "elevenlabs"
    ? (transcriptSegments.length ? transcriptSegments[transcriptSegments.length - 1].end : 0)
    : audioChunksProcessed * CHUNK_DURATION_SEC;
  setStatus(`Stopped. ${(duration).toFixed(1)}s transcribed. Click Analyze to send to MediaGuard.`);
}

speechBtn.addEventListener("click", async () => {
  if (isRecording) {
    stopRecording();
    return;
  }
  if (getProvider() === "local") {
    if (!modelInitialized) {
      pendingStart = true;
      initializeModel();
      return;
    }
  }
  await startRecording();
});

analyzeBtn.addEventListener("click", async () => {
  const text = transcriptWords.join(" ").trim();
  if (!text) {
    setStatus("No transcription to analyze.");
    return;
  }

  const transcript =
    transcriptSegments.length > 0
      ? transcriptSegments
      : [
          {
            text,
            start: 0,
            end: Math.max(
              audioChunksProcessed * CHUNK_DURATION_SEC,
              1
            ),
          },
        ];

  const apiUrl = getApiUrl();
  const mistralKey = (document.getElementById("mistral-key")?.value || "").trim();

  if (!mistralKey) {
    setStatus("Enter Mistral API key to analyze.");
    return;
  }

  analyzeBtn.disabled = true;
  setStatus("Analyzing…");

  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_id: getVideoId(),
        transcript,
        mistral_api_key: mistralKey,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setStatus("Analysis failed: " + (data.reason || data.message || res.status));
      analyzeBtn.disabled = false;
      return;
    }

    renderSegments(data.alerts || [], data.fact_checks || []);
    setStatus(`Analysis complete. ${(data.alerts?.length || 0) + (data.fact_checks?.length || 0)} segments.`);
  } catch (err) {
    setStatus("Error: " + err.message);
  } finally {
    analyzeBtn.disabled = false;
  }
});

function renderSegments(alerts, factChecks) {
  segmentsRoot.innerHTML = "";
  segmentsRoot.hidden = false;

  const items = [
    ...(alerts || []).map((a) => ({ ...a, type: "manipulation" })),
    ...(factChecks || []).map((f) => ({ ...f, type: "fact-check" })),
  ].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  for (const s of items) {
    const div = document.createElement("div");
    div.className = `segment ${s.type === "manipulation" ? "manipulation" : "fact-check"}`;
    const timeStr =
      s.start != null && s.end != null
        ? `${s.start.toFixed(1)}s–${s.end.toFixed(1)}s`
        : "";
    div.innerHTML = `
      <div class="segment-header">${s.type === "manipulation" ? (s.technique || "Manipulation") : "Fact check"}</div>
      ${s.quote ? `<div class="segment-quote">"${escapeHtml(s.quote)}"</div>` : ""}
      ${s.claim ? `<div class="segment-quote">${escapeHtml(s.claim)}</div>` : ""}
      ${s.explanation ? `<div class="segment-explanation">${escapeHtml(s.explanation)}</div>` : ""}
      ${s.context ? `<div class="segment-explanation">${escapeHtml(s.context)}</div>` : ""}
      ${timeStr ? `<div class="segment-time">${timeStr}</div>` : ""}
    `;
    segmentsRoot.appendChild(div);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
