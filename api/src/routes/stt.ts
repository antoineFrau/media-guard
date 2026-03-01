import { Hono } from "hono";
import { RealtimeTranscription, AudioEncoding } from "@mistralai/mistralai/extra/realtime/index.js";

const MISTRAL_MODEL = "voxtral-mini-transcribe-realtime-2602";

export const sttRoutes = new Hono();

async function* createAudioStream(
  getNext: () => Promise<{ data: string } | null>
): AsyncGenerator<Uint8Array, void, unknown> {
  while (true) {
    const msg = await getNext();
    if (!msg) break;
    const bytes = Buffer.from(msg.data, "base64");
    yield new Uint8Array(bytes);
  }
}

export async function runMistralTranscription(
  apiKey: string,
  audioQueue: { getNext: () => Promise<{ data: string } | null> },
  sendToClient: (obj: object) => void
) {
  const client = new RealtimeTranscription({ apiKey });
  const audioStream = createAudioStream(audioQueue.getNext);
  try {
    for await (const event of client.transcribeStream(audioStream, MISTRAL_MODEL, {
      serverUrl: "wss://api.mistral.ai",
      audioFormat: {
        encoding: AudioEncoding.PcmS16le,
        sampleRate: 16000,
      },
    })) {
      if (event.type === "transcription.text.delta" && "text" in event) {
        sendToClient({ type: "partial", text: event.text });
      } else if (event.type === "transcription.segment" && "text" in event) {
        const seg = event as { text: string; start: number; end: number };
        sendToClient({
          type: "committed",
          text: seg.text,
          start: seg.start ?? 0,
          end: seg.end ?? 0,
          words: [{ text: seg.text, start: seg.start, end: seg.end }],
        });
      } else if (event.type === "transcription.done") {
        sendToClient({ type: "done" });
      } else if (event.type === "error" && "error" in event) {
        const err = event.error as { message?: string };
        sendToClient({ type: "error", error: err?.message ?? "Transcription error" });
      }
    }
  } catch (err) {
    sendToClient({
      type: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

async function fetchElevenLabsToken(apiKey: string) {
  const res = await fetch(
    "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `ElevenLabs returned ${res.status}`);
  }

  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("No token in response");
  return data.token;
}

sttRoutes.get("/elevenlabs-token", async (c) => {
  console.log("[MediaGuard API] GET /stt/elevenlabs-token");
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return c.json(
      {
        reason: "elevenlabs_not_configured",
        message: "ELEVENLABS_API_KEY not set in server environment.",
      },
      503
    );
  }

  try {
    const token = await fetchElevenLabsToken(apiKey);
    console.log("[MediaGuard API] ElevenLabs token OK");
    return c.json({ token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.log("[MediaGuard API] ElevenLabs token error:", msg);
    return c.json(
      { reason: "elevenlabs_error", message: msg },
      502
    );
  }
});

/** POST with optional { api_key } to use user's key instead of env */
sttRoutes.post("/elevenlabs-token", async (c) => {
  console.log("[MediaGuard API] POST /stt/elevenlabs-token");
  let body: { api_key?: string };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const apiKey = (body.api_key || "").trim() || process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return c.json(
      {
        reason: "elevenlabs_not_configured",
        message: "Provide api_key in body or set ELEVENLABS_API_KEY in server.",
      },
      400
    );
  }

  try {
    const token = await fetchElevenLabsToken(apiKey);
    console.log("[MediaGuard API] ElevenLabs token OK (POST)");
    return c.json({ token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.log("[MediaGuard API] ElevenLabs token error (POST):", msg);
    return c.json({ reason: "elevenlabs_error", message: msg }, 502);
  }
});
