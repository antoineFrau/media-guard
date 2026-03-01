import { Hono } from "hono";
import { prisma } from "../index.js";

export const annotationsRoutes = new Hono();

annotationsRoutes.post("/:id/vote", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const vote = body.vote === "up" ? "up" : body.vote === "down" ? "down" : null;
  const clientId = typeof body.client_id === "string" ? body.client_id.trim() : null;
  if (!vote) {
    return c.json(
      { reason: "invalid_request", message: "vote must be 'up' or 'down'" },
      400
    );
  }
  if (!clientId) {
    return c.json(
      { reason: "invalid_request", message: "client_id is required" },
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

  const existingVote = await prisma.annotationVote.findUnique({
    where: {
      annotationId_clientId: { annotationId: id, clientId },
    },
  });

  await prisma.$transaction(async (tx) => {
    if (existingVote) {
      if (existingVote.vote === vote) return;
      await tx.annotationVote.update({
        where: { id: existingVote.id },
        data: { vote },
      });
      await tx.annotation.update({
        where: { id },
        data:
          existingVote.vote === "up"
            ? { upvotes: { decrement: 1 }, downvotes: { increment: 1 } }
            : { upvotes: { increment: 1 }, downvotes: { decrement: 1 } },
      });
    } else {
      await tx.annotationVote.create({
        data: { annotationId: id, clientId, vote },
      });
      await tx.annotation.update({
        where: { id },
        data:
          vote === "up"
            ? { upvotes: { increment: 1 } }
            : { downvotes: { increment: 1 } },
      });
    }
  });

  const updated = await prisma.annotation.findUniqueOrThrow({
    where: { id },
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
    user_vote: vote,
    created_at: updated.createdAt,
    updated_at: updated.updatedAt,
  });
});

annotationsRoutes.get("/:videoId", async (c) => {
  const videoId = c.req.param("videoId");
  const clientId = c.req.query("client_id");

  const annotations = await prisma.annotation.findMany({
    where: { videoId },
    orderBy: [{ timestampStart: "asc" }],
    include: {
      comments: true,
      ...(clientId
        ? { votes: { where: { clientId } } }
        : {}),
    },
  });

  return c.json(
    annotations.map((a) => {
      const votes = "votes" in a && Array.isArray(a.votes) ? a.votes : [];
      const userVote =
        clientId && votes[0] ? (votes[0].vote as "up" | "down") : null;
      return {
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
        user_vote: userVote ?? undefined,
        created_at: a.createdAt,
        updated_at: a.updatedAt,
      };
    })
  );
});
