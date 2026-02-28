import { Hono } from "hono";
import { prisma } from "../index.js";

export const annotationsRoutes = new Hono();

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
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    }))
  );
});
