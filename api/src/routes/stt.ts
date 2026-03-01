import { Hono } from "hono";

export const sttRoutes = new Hono();

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
