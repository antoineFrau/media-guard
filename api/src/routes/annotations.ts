import { Hono } from "hono";
import { prisma } from "../index.js";

export const annotationsRoutes = new Hono();

annotationsRoutes.post("/:id/vote", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const vote = body.vote === "up" ? "up" : body.vote === "down" ? "down" : null;
  if (!vote) {
    return c.json(
      { reason: "invalid_request", message: "vote must be 'up' or 'down'" },
      400
    );
  }
  const annotation = await prisma.annotation.findUnique({
    where: { id },
  });
  if (!annotation) {
    return c.json(
      { reason: "not_found", message: "Annotation not found" },
      404
    );
  }
  const updated = await prisma.annotation.update({
    where: { id },
    data:
      vote === "up"
        ? { upvotes: { increment: 1 } }
        : { downvotes: { increment: 1 } },
  });
  return c.json({
    id: updated.id,
    video_id: updated.videoId,
    timestamp_start: updated.timestampStart,
    timestamp_end: updated.timestampEnd,
    type: updated.type.toLowerCase(),
    content: updated.content,
    explanation: updated.explanation,
    sources: updated.sources as string[],
    user_comments: updated.userComments,
    version: updated.version,
    upvotes: updated.upvotes,
    downvotes: updated.downvotes,
    created_at: updated.createdAt,
    updated_at: updated.updatedAt,
  });
});

annotationsRoutes.get("/:videoId", async (c) => {
  const videoId = c.req.param("videoId");

  const annotations = await prisma.annotation.findMany({
    where: { videoId },
    orderBy: [{ timestampStart: "asc" }],
    include: {
      comments: true,
    },
  });

  return c.json(
    annotations.map((a) => ({
      id: a.id,
      video_id: a.videoId,
      timestamp_start: a.timestampStart,
      timestamp_end: a.timestampEnd,
      type: a.type.toLowerCase(),
      content: a.content,
      explanation: a.explanation,
      sources: a.sources as string[],
      user_comments: a.userComments,
      version: a.version,
      upvotes: a.upvotes,
      downvotes: a.downvotes,
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    }))
  );
});
