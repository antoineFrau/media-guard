import { Hono } from "hono";
import { prisma } from "../index.js";
import { fetchTranscript } from "../lib/youtube-transcript.js";
import { analyzeTranscript } from "../lib/mistral.js";
import { traceAnalysis } from "../lib/langfuse.js";

export const videoRoutes = new Hono();

videoRoutes.get("/:videoId/analysis", async (c) => {
  const videoId = c.req.param("videoId");
  const hasMistralHeader = !!c.req.header("X-Mistral-API-Key");
  console.log(`[MediaGuard API] GET /video/${videoId}/analysis — Mistral header: ${hasMistralHeader}`);

  // 1. Check cache
  const cached = await prisma.videoAnalysis.findUnique({
    where: { videoId },
  });

  if (cached) {
    console.log(`[MediaGuard API] Cache HIT for ${videoId}`);
    return c.json({
      video_id: cached.videoId,
      transcript: cached.transcript ?? undefined,
      transcript_source: cached.transcriptSource ?? undefined,
      alerts: cached.alerts as object[],
      fact_checks: cached.factChecks as object[],
    });
  }

  // 2. Fetch transcript
  console.log(`[MediaGuard API] Cache MISS for ${videoId} — fetching transcript`);
  const mistralKey = c.req.header("X-Mistral-API-Key") ?? undefined;
  const transcript = await fetchTranscript(videoId);

  if (!transcript || transcript.length === 0) {
    console.log(`[MediaGuard API] No transcript for ${videoId}`);
    return c.json({ reason: "no_transcript" }, 404);
  }
  console.log(`[MediaGuard API] Transcript fetched for ${videoId} (${transcript.length} segments)`);

  // 3. Analyze with Mistral (needs API key for cache miss)
  const apiKey = mistralKey ?? process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.log(`[MediaGuard API] Mistral key missing for ${videoId}`);
    return c.json(
      {
        reason: "analysis_failed",
        message: "Mistral API key required. Send X-Mistral-API-Key header.",
      },
      400
    );
  }

  console.log(`[MediaGuard API] Analyzing ${videoId} with Mistral...`);
  const analysis = await traceAnalysis(videoId, transcript, (trace) =>
    analyzeTranscript(transcript, apiKey, trace)
  );
  if (!analysis) {
    console.log(`[MediaGuard API] Mistral analysis failed for ${videoId}`);
    return c.json({ reason: "analysis_failed" }, 500);
  }
  console.log(`[MediaGuard API] Mistral done for ${videoId}: ${analysis.alerts?.length ?? 0} alerts, ${analysis.fact_checks?.length ?? 0} fact-checks`);

  // 4. Store transcript and seed annotations
  const hash = transcript.map((t) => t.text).join("").slice(0, 64);
  await prisma.videoAnalysis.create({
    data: {
      videoId,
      transcriptHash: hash,
      transcript: transcript as object,
      transcriptSource: "youtube",
      alerts: analysis.alerts,
      factChecks: analysis.fact_checks,
    },
  });

  for (const alert of analysis.alerts) {
    const a = alert as { start?: number; end?: number; technique?: string; explanation?: string; quote?: string };
    await prisma.annotation.create({
      data: {
        videoId,
        timestampStart: a.start ?? 0,
        timestampEnd: a.end ?? 0,
        type: "MANIPULATION",
        content: a.technique ?? a.quote ?? "Alert",
        explanation: a.explanation,
        sources: [],
      },
    });
  }
  for (const fc of analysis.fact_checks) {
    const f = fc as { start?: number; end?: number; claim?: string; context?: string; sources?: string[] };
    await prisma.annotation.create({
      data: {
        videoId,
        timestampStart: f.start ?? 0,
        timestampEnd: f.end ?? 0,
        type: "FACT_CHECK",
        content: f.claim ?? "Claim",
        explanation: f.context,
        sources: f.sources ?? [],
      },
    });
  }

  console.log(`[MediaGuard API] Stored and returning analysis for ${videoId}`);
  return c.json({
    video_id: videoId,
    transcript,
    transcript_source: "youtube",
    alerts: analysis.alerts,
    fact_checks: analysis.fact_checks,
  });
});
