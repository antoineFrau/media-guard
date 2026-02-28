import { Hono } from "hono";
import { prisma } from "../index.js";
import { fetchTranscript } from "../lib/youtube-transcript.js";
import { analyzeTranscript } from "../lib/mistral.js";

export const videoRoutes = new Hono();

videoRoutes.get("/:videoId/analysis", async (c) => {
  const videoId = c.req.param("videoId");

  // 1. Check cache
  const cached = await prisma.videoAnalysis.findUnique({
    where: { videoId },
  });

  if (cached) {
    return c.json({
      video_id: cached.videoId,
      alerts: cached.alerts as object[],
      fact_checks: cached.factChecks as object[],
    });
  }

  // 2. Fetch transcript
  const mistralKey = c.req.header("X-Mistral-API-Key") ?? undefined;
  const transcript = await fetchTranscript(videoId);

  if (!transcript || transcript.length === 0) {
    return c.json({ reason: "no_transcript" }, 404);
  }

  // 3. Analyze with Mistral (needs API key for cache miss)
  const apiKey = mistralKey ?? process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return c.json(
      {
        reason: "analysis_failed",
        message: "Mistral API key required. Send X-Mistral-API-Key header.",
      },
      400
    );
  }

  const analysis = await analyzeTranscript(transcript, apiKey);
  if (!analysis) {
    return c.json({ reason: "analysis_failed" }, 500);
  }

  // 4. Store and seed annotations
  const hash = transcript.map((t) => t.text).join("").slice(0, 64);
  await prisma.videoAnalysis.create({
    data: {
      videoId,
      transcriptHash: hash,
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

  return c.json({
    video_id: videoId,
    alerts: analysis.alerts,
    fact_checks: analysis.fact_checks,
  });
});
