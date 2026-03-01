/**
 * Mistral Voxtral real-time speech-to-text client via MediaGuard API WebSocket proxy.
 * Streams PCM audio at 16kHz and receives partial/committed transcripts.
 */

const INPUT_SAMPLE_RATE = 24000;
const MISTRAL_SAMPLE_RATE = 16000;

/**
 * Converts Float32 audio to Int16 PCM and base64.
 */
function float32ToPcmBase64(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Resamples Float32 audio from inputRate to 16kHz (Mistral requirement).
 */
function resampleTo16k(input, fromRate) {
  if (fromRate === MISTRAL_SAMPLE_RATE) return input;
  const ratio = fromRate / MISTRAL_SAMPLE_RATE;
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

/**
 * Mistral Voxtral real-time STT client (via API proxy).
 * @param {Object} opts
 * @param {string} opts.apiUrl - MediaGuard API base URL
 * @param {string} opts.mistralApiKey - Mistral API key for transcription
 */
export class MistralClient {
  constructor(opts) {
    this.apiUrl = (opts.apiUrl || "http://localhost:3000").replace(/\/$/, "");
    this.mistralApiKey = opts.mistralApiKey || null;
    this.ws = null;
    this.onTranscript = null;
    this.onStatus = null;
    this.words = [];
    this.segments = [];
    this.sessionStartTime = 0;
  }

  _status(msg) {
    if (typeof this.onStatus === "function") this.onStatus(msg);
  }

  _emitPartial(text) {
    if (typeof this.onTranscript === "function") {
      this.onTranscript({ type: "partial", text });
    }
  }

  _emitCommitted(text, words) {
    if (typeof this.onTranscript === "function") {
      const start = words?.length ? words[0].start : 0;
      const end = words?.length ? words[words.length - 1].end : 0;
      this.onTranscript({ type: "committed", text, start, end, words });
    }
  }

  async start() {
    if (!this.mistralApiKey) {
      throw new Error("Mistral API key required. Provide mistralApiKey in options.");
    }
    const base = this.apiUrl.replace(/^http/, "ws");
    const url = `${base}/stt/mistral-stream?api_key=${encodeURIComponent(this.mistralApiKey)}`;

    this._status("Connecting to Mistral…");

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.sessionStartTime = Date.now() / 1000;

      this.ws.onopen = () => {
        this._status("Mistral connected. Listening…");
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "partial":
              this._emitPartial(msg.text || "");
              break;
            case "committed":
              if (msg.words?.length) {
                const start = msg.words[0].start ?? 0;
                const end = msg.words[msg.words.length - 1].end ?? start + 1;
                this.segments.push({ text: msg.text || "", start, end });
                this.words = this.words.concat(msg.words.map((w) => w.text).filter(Boolean));
              } else {
                this.words = this.words.concat((msg.text || "").split(/\s+/).filter(Boolean));
              }
              this._emitCommitted(msg.text || "", msg.words);
              break;
            case "done":
              break;
            case "error":
              this._status("Mistral: " + (msg.error || "Unknown error"));
              break;
            default:
              break;
          }
        } catch {
          // ignore parse errors
        }
      };

      this.ws.onerror = () => {
        this._status("WebSocket error");
        reject(new Error("WebSocket error"));
      };

      this.ws.onclose = () => {};
    });
  }

  sendAudio(float32Chunk) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const resampled = resampleTo16k(float32Chunk, INPUT_SAMPLE_RATE);
    const audioBase64 = float32ToPcmBase64(resampled);
    this.ws.send(JSON.stringify({ type: "audio", data: audioBase64 }));
  }

  stop() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "end" }));
      this.ws.close();
    }
    this.ws = null;
  }

  getTranscript() {
    return this.words.join(" ");
  }

  getSegments() {
    if (this.segments.length > 0) {
      return this.segments;
    }
    const text = this.words.join(" ");
    if (!text) return [];
    return [{ text, start: 0, end: Math.max(1, Date.now() / 1000 - this.sessionStartTime) }];
  }
}
