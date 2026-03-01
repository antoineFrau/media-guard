/**
 * ElevenLabs Scribe v2 real-time speech-to-text WebSocket client.
 * Streams PCM audio and receives partial/committed transcripts.
 */

const SAMPLE_RATE = 24000;
const WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

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
 * ElevenLabs real-time STT client.
 * @param {Object} opts
 * @param {string} opts.apiUrl - MediaGuard API base URL (for token)
 * @param {string} [opts.elevenlabsApiKey] - Optional: use direct API key (bypass token endpoint)
 */
export class ElevenLabsClient {
  constructor(opts) {
    this.apiUrl = (opts.apiUrl || "http://localhost:3000").replace(/\/$/, "");
    this.elevenlabsApiKey = opts.elevenlabsApiKey || null;
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

  async _getToken() {
    let res;
    if (this.elevenlabsApiKey) {
      res = await fetch(`${this.apiUrl}/stt/elevenlabs-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: this.elevenlabsApiKey }),
      });
    } else {
      res = await fetch(`${this.apiUrl}/stt/elevenlabs-token`);
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.reason || `Token request failed: ${res.status}`);
    }
    return data.token;
  }

  async start() {
    this._status("Getting ElevenLabs token…");
    const token = await this._getToken();
    const params = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      audio_format: "pcm_24000",
      include_timestamps: "true",
      commit_strategy: "vad",
    });
    params.set("token", token);

    const url = `${WS_URL}?${params.toString()}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.sessionStartTime = Date.now() / 1000;

      this.ws.onopen = () => {
        this._status("ElevenLabs connected. Listening…");
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.message_type) {
            case "session_started":
              break;
            case "partial_transcript":
              this._emitPartial(msg.text || "");
              break;
            case "committed_transcript":
              this.words = this.words.concat((msg.text || "").split(/\s+/).filter(Boolean));
              this._emitCommitted(msg.text || "", null);
              break;
            case "committed_transcript_with_timestamps":
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
            case "error":
            case "auth_error":
            case "quota_exceeded":
            case "rate_limited":
              this._status("ElevenLabs error: " + (msg.error || "Unknown"));
              break;
            default:
              break;
          }
        } catch {
          // ignore parse errors
        }
      };

      this.ws.onerror = (err) => {
        this._status("WebSocket error");
        reject(err);
      };

      this.ws.onclose = () => {};

      this.ws.binaryType = "arraybuffer";
    });
  }

  sendAudio(float32Chunk) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const audioBase64 = float32ToPcmBase64(float32Chunk);
    this.ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: audioBase64,
        sample_rate: SAMPLE_RATE,
        commit: false,
      })
    );
  }

  stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
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
    return [{ text, start: 0, end: Math.max(1, (Date.now() / 1000) - this.sessionStartTime) }];
  }
}
