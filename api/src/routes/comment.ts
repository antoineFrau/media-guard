import { Hono } from "hono";
import { prisma } from "../index.js";
import { improveAnnotationWithMistral } from "../lib/mistral.js";

export const commentRoutes = new Hono();

commentRoutes.post("/improve", async (c) => {
  let body: {
    video_id: string;
    annotation_id: string;
    timestamp_start?: number;
    user_comment: string;
    current_content?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { reason: "invalid_request", message: "Invalid JSON body" },
      400
    );
  }

  const { annotation_id, user_comment } = body;

  if (!annotation_id || !user_comment) {
    return c.json(
      { reason: "invalid_request", message: "annotation_id and user_comment required" },
      400
    );
  }

  const apiKey = c.req.header("X-Mistral-API-Key") ?? process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return c.json(
      { reason: "improve_failed", message: "Mistral API key required (X-Mistral-API-Key)" },
      400
    );
  }

  const annotation = await prisma.annotation.findUnique({
    where: { id: annotation_id },
  });

  if (!annotation) {
    return c.json({ reason: "not_found", message: "Annotation not found" }, 404);
  }

  const improved = await improveAnnotationWithMistral(
    annotation.content,
    annotation.explanation ?? "",
    annotation.sources as string[],
    user_comment,
    apiKey
  );

  if (!improved) {
    return c.json({ reason: "improve_failed" }, 500);
  }

  const updated = await prisma.annotation.update({
    where: { id: annotation_id },
    data: {
      content: improved.content ?? annotation.content,
      explanation: improved.explanation ?? annotation.explanation,
      sources: improved.sources ?? (annotation.sources as object[]),
      version: { increment: 1 },
    },
  });

  await prisma.annotationComment.create({
    data: {
      annotationId: annotation_id,
      userContent: user_comment,
      mistralImprovedContent: improved,
      status: "APPLIED",
    },
  });

  return c.json({
    id: updated.id,
    video_id: updated.videoId,
    timestamp_start: updated.timestampStart,
    timestamp_end: updated.timestampEnd,
    type: updated.type.toLowerCase(),
    content: updated.content,
    explanation: updated.explanation,
    sources: updated.sources,
    user_comments: updated.userComments,
    version: updated.version,
    created_at: updated.createdAt,
    updated_at: updated.updatedAt,
  });
});
