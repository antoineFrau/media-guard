import type { TranscriptSegment } from "./types.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface PlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{ baseUrl: string; languageCode?: string }>;
    };
  };
}

interface TimedTextEvent {
  tStartMs: number;
  dDurationMs: number;
  segs?: Array<{ utf8?: string }>;
}

interface TimedTextResponse {
  events?: TimedTextEvent[];
}

export async function fetchTranscript(
  videoId: string
): Promise<TranscriptSegment[] | null> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return null;
  }

  const playerUrl = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
  const body = JSON.stringify({
    context: {
      client: {
        clientName: "WEB",
        clientVersion: "2.20240101.00.00",
      },
    },
    videoId,
  });

  let playerRes: Response;
  try {
    playerRes = await fetch(playerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body,
    });
  } catch {
    return null;
  }

  if (!playerRes.ok) {
    return null;
  }

  let playerData: PlayerResponse;
  try {
    playerData = (await playerRes.json()) as PlayerResponse;
  } catch {
    return null;
  }

  const captionTracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captionTracks?.length) {
    return null;
  }

  const baseUrl = captionTracks[0].baseUrl;
  const captionUrl = baseUrl.includes("?")
    ? `${baseUrl}&fmt=json3`
    : `${baseUrl}?fmt=json3`;

  let captionRes: Response;
  try {
    captionRes = await fetch(captionUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
  } catch {
    return null;
  }

  if (!captionRes.ok) {
    return null;
  }

  let captionData: TimedTextResponse;
  try {
    captionData = (await captionRes.json()) as TimedTextResponse;
  } catch {
    return null;
  }

  const events = captionData?.events ?? [];
  const segments: TranscriptSegment[] = [];

  for (const ev of events) {
    if (!ev.segs) continue;

    const text = ev.segs.map((s) => s.utf8 ?? "").join("").trim();
    if (!text) continue;

    const start = ev.tStartMs / 1000;
    const end = (ev.tStartMs + (ev.dDurationMs ?? 0)) / 1000;

    segments.push({ text, start, end });
  }

  return segments.length > 0 ? segments : null;
}
