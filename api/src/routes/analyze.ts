import { Hono } from "hono";
import { prisma } from "../index.js";
import { analyzeTranscript } from "../lib/mistral.js";
import type { TranscriptSegment } from "../lib/types.js";

export const analyzeRoutes = new Hono();

analyzeRoutes.post("/", async (c) => {
  let body: {
    video_id: string;
    transcript: TranscriptSegment[];
    mistral_api_key?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { reason: "invalid_request", message: "Invalid JSON body" },
      400
    );
  }

  const { video_id, transcript, mistral_api_key } = body;

  if (!video_id || !transcript || !Array.isArray(transcript)) {
    return c.json(
      { reason: "invalid_request", message: "video_id and transcript required" },
      400
    );
  }

  const apiKey = mistral_api_key ?? c.req.header("X-Mistral-API-Key") ?? process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return c.json(
      { reason: "analysis_failed", message: "Mistral API key required" },
      400
    );
  }

  const analysis = await analyzeTranscript(transcript, apiKey);
  if (!analysis) {
    return c.json({ reason: "analysis_failed" }, 500);
  }

  const hash = transcript.map((t) => t.text).join("").slice(0, 64);

  await prisma.$transaction(async (tx) => {
    await tx.annotation.deleteMany({ where: { videoId: video_id } });
    await tx.videoAnalysis.upsert({
      where: { videoId: video_id },
      create: {
        videoId: video_id,
        transcriptHash: hash,
        alerts: analysis.alerts,
        factChecks: analysis.fact_checks,
      },
      update: {
        transcriptHash: hash,
        alerts: analysis.alerts,
        factChecks: analysis.fact_checks,
      },
    });
  });

  for (const alert of analysis.alerts) {
    const a = alert as { start?: number; end?: number; technique?: string; explanation?: string; quote?: string };
    await prisma.annotation.create({
      data: {
        videoId: video_id,
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
        videoId: video_id,
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
    video_id: video_id,
    alerts: analysis.alerts,
    fact_checks: analysis.fact_checks,
  });
});
