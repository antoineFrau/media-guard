import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Innertube } from "youtubei.js";
import {
  fetchTranscript as fetchTranscriptInternal,
  type TranscriptSegment,
} from "./youtube-transcript-fetcher.js";

const CHANNEL_URL = "https://www.youtube.com/@Clemovitch";

export interface VideoWithTranscript {
  videoId: string;
  title: string;
  url: string;
  transcript: TranscriptSegment[];
}

const CACHE_FILENAME = "transcript.json";

/** Check if a file exists. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load transcript from cache if it exists.
 */
async function loadCachedTranscript(
  transcriptsDir: string,
  videoId: string
): Promise<VideoWithTranscript | null> {
  const cachePath = join(transcriptsDir, videoId, CACHE_FILENAME);
  if (!(await fileExists(cachePath))) return null;

  try {
    const raw = await readFile(cachePath, "utf-8");
    const data = JSON.parse(raw) as {
      videoId?: string;
      title?: string;
      url?: string;
      transcript?: TranscriptSegment[];
    };
    if (!data.transcript?.length || !data.videoId) return null;
    return {
      videoId: data.videoId,
      title: data.title ?? "Unknown",
      url: data.url ?? `https://www.youtube.com/watch?v=${data.videoId}`,
      transcript: data.transcript,
    };
  } catch {
    return null;
  }
}

/**
 * Save transcript to cache.
 */
async function saveTranscriptToCache(
  transcriptsDir: string,
  video: VideoWithTranscript
): Promise<void> {
  const videoDir = join(transcriptsDir, video.videoId);
  const cachePath = join(videoDir, CACHE_FILENAME);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(videoDir, { recursive: true });
  await writeFile(
    cachePath,
    JSON.stringify(
      {
        ...video,
        fetchedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );
}

/**
 * Fetches transcript for a video using the internal get_transcript API (from mcp-server-youtube-transcript).
 * Falls back to youtubei.js if the internal fetcher fails.
 */
async function fetchTranscriptForVideo(
  videoId: string,
  titleFromChannel?: string,
  useYoutubeiFallback: boolean = true
): Promise<VideoWithTranscript | null> {
  // Prefer internal fetcher (ANDROID client, more reliable)
  const internal = await fetchTranscriptInternal(videoId, "en");
  if (internal && internal.segments.length > 0) {
    return {
      videoId,
      title: internal.metadata.title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      transcript: internal.segments,
    };
  }

  if (!useYoutubeiFallback) return null;

  try {
    const innertube = await Innertube.create({ generate_session_locally: true });
    const info = await innertube.getInfo(videoId);
    if (!info) return null;

    const transcriptInfo = await (info as { getTranscript?: () => Promise<unknown> }).getTranscript?.();
    if (!transcriptInfo) return null;

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
        parsed.push({ text, start: startMs / 1000, end: endMs / 1000 });
      }
    }

    if (parsed.length > 0) {
      return {
        videoId,
        title: titleFromChannel ?? "Unknown",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        transcript: parsed,
      };
    }
  } catch {
    /* fallback failed */
  }
  return null;
}

/**
 * Get transcript from cache or fetch from YouTube, then save to cache.
 */
async function getOrFetchTranscript(
  transcriptsDir: string,
  videoId: string,
  titleFromChannel?: string,
  useYoutubeiFallback: boolean = true
): Promise<VideoWithTranscript | null> {
  const cached = await loadCachedTranscript(transcriptsDir, videoId);
  if (cached) {
    console.log(`  [cache] ${videoId}: ${cached.title}`);
    return cached;
  }

  const v = await fetchTranscriptForVideo(videoId, titleFromChannel, useYoutubeiFallback);
  if (v) {
    await saveTranscriptToCache(transcriptsDir, v);
    console.log(`  [fetched] ${videoId}: ${v.title}`);
  }
  return v;
}

/**
 * Fetches videos with transcripts. Supports:
 * 1. MEDIAGUARD_VIDEO_IDS env: comma-separated video IDs (bypasses channel fetch)
 * 2. youtubei.js channel fetch for @Clemovitch
 * Transcripts are cached in transcriptsDir (output/transcripts/{videoId}/transcript.json).
 */
export async function fetchChannelVideosWithTranscripts(
  lastN: number = 10,
  transcriptsDir: string
): Promise<VideoWithTranscript[]> {
  const manualIds = process.env.MEDIAGUARD_VIDEO_IDS?.trim();
  if (manualIds) {
    const ids = manualIds.split(",").map((id) => id.trim()).filter(Boolean);
    if (ids.length > 0) {
      console.log(`Using MEDIAGUARD_VIDEO_IDS: ${ids.length} video(s)`);
      const result: VideoWithTranscript[] = [];
      for (const videoId of ids.slice(0, lastN)) {
        const v = await getOrFetchTranscript(transcriptsDir, videoId, undefined, false);
        if (v) result.push(v);
        else console.warn(`Skipping ${videoId}: no transcript`);
      }
      return result;
    }
  }

  const innertube = await Innertube.create({ generate_session_locally: true });
  const endpoint = await innertube.resolveURL(CHANNEL_URL);
  if (!endpoint) {
    throw new Error(`Failed to resolve channel URL: ${CHANNEL_URL}`);
  }

  const response = await innertube.call(endpoint, { parse: true });
  if (!response) {
    throw new Error(`Failed to fetch channel: ${CHANNEL_URL}`);
  }

  const channel = response as { getVideos?: () => Promise<unknown> };
  const videosResponse = await channel.getVideos?.();
  if (!videosResponse) {
    throw new Error(
      "No videos found on channel. Set MEDIAGUARD_VIDEO_IDS=id1,id2,id3 to use specific videos."
    );
  }

  const vResp = videosResponse as { videos?: unknown[] };
  const videoList = (vResp.videos ?? []) as {
    video_id?: string;
    id?: string;
    title?: { toString?: () => string; text?: string };
  }[];
  if (!videoList.length) {
    throw new Error(
      "No videos found on channel. Set MEDIAGUARD_VIDEO_IDS=id1,id2,id3 to use specific videos."
    );
  }

  const lastVideos = videoList.slice(0, lastN);
  const result: VideoWithTranscript[] = [];

  for (const video of lastVideos) {
    const videoId = video.video_id ?? video.id;
    const title =
      (typeof video.title === "string"
        ? video.title
        : video.title?.toString?.() ?? video.title?.text) ?? "Unknown";

    if (!videoId) continue;

    const v = await getOrFetchTranscript(transcriptsDir, videoId, title, true);
    if (v) result.push(v);
    else console.warn(`Skipping ${videoId}: ${title}`);
  }

  return result;
}
