import { Innertube } from "youtubei.js";
import type { TranscriptSegment } from "./types.js";

const CHANNEL_URL = "https://www.youtube.com/@Clemovitch";

export interface VideoWithTranscript {
  videoId: string;
  title: string;
  url: string;
  transcript: TranscriptSegment[];
}

/**
 * Fetches the last N videos from the Clemovitch channel and their transcripts.
 */
export async function fetchChannelVideosWithTranscripts(
  lastN: number = 10
): Promise<VideoWithTranscript[]> {
  const innertube = await Innertube.create({ generate_session_locally: true });

  // Resolve channel URL to get browse endpoint, then fetch channel page
  const endpoint = await innertube.resolveURL(CHANNEL_URL);
  if (!endpoint) {
    throw new Error(`Failed to resolve channel URL: ${CHANNEL_URL}`);
  }

  const response = await innertube.call(endpoint, { parse: true });
  if (!response) {
    throw new Error(`Failed to fetch channel: ${CHANNEL_URL}`);
  }

  // Response is a Channel; get videos tab
  const channel = response as { getVideos?: () => Promise<{ videos?: unknown[] }> };
  const videosResponse = await channel.getVideos?.();
  if (!videosResponse?.videos?.length) {
    throw new Error("No videos found on channel.");
  }

  const videoList = videosResponse.videos as { video_id?: string; id?: string; title?: { toString?: () => string; text?: string } }[];
  const lastVideos = videoList.slice(0, lastN);
  const result: VideoWithTranscript[] = [];

  for (const video of lastVideos) {
    const videoId = video.video_id ?? video.id;
    const title =
      (typeof video.title === "string"
        ? video.title
        : video.title?.toString?.() ?? video.title?.text) ?? "Unknown";

    if (!videoId) continue;

    try {
      const info = await innertube.getInfo(videoId);
      if (!info) continue;

      const transcriptInfo = await (info as { getTranscript?: () => Promise<unknown> }).getTranscript?.();
      if (!transcriptInfo) continue;

      const transcript = (transcriptInfo as {
        transcript?: { content?: { body?: { initial_segments?: unknown[] } } };
      }).transcript;
      const body = transcript?.content?.body;
      const segments = body?.initial_segments ?? [];

      const parsed: TranscriptSegment[] = [];
      for (const seg of segments) {
        const s = seg as {
          type?: string;
          snippet?: { toString?: () => string; text?: string };
          start_ms?: string;
          end_ms?: string;
        };
        if (s?.type === "TranscriptSegment" && s.snippet != null) {
          const text =
            typeof s.snippet === "string"
              ? s.snippet
              : s.snippet?.toString?.() ?? s.snippet?.text ?? "";
          const startMs = parseInt(String(s.start_ms ?? "0"), 10);
          const endMs = parseInt(String(s.end_ms ?? "0"), 10);
          parsed.push({
            text,
            start: startMs / 1000,
            end: endMs / 1000,
          });
        }
      }

      if (parsed.length > 0) {
        result.push({
          videoId,
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          transcript: parsed,
        });
      }
    } catch (err) {
      console.warn(
        `Skipping video ${videoId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}
