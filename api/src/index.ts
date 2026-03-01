import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { PrismaClient } from "@prisma/client";
import { videoRoutes } from "./routes/video.js";
import { analyzeRoutes } from "./routes/analyze.js";
import { annotationsRoutes } from "./routes/annotations.js";
import { commentRoutes } from "./routes/comment.js";
import { sttRoutes } from "./routes/stt.js";
import { createMistralStreamWsHandler } from "./routes/stt-mistral-ws.js";

export const prisma = new PrismaClient();

const app = new Hono();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use("*", async (c, next) => {
  console.log(`[MediaGuard API] ${c.req.method} ${c.req.path}`);
  await next();
});

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Mistral-API-Key"],
  })
);

app.route("/video", videoRoutes);
app.route("/analyze", analyzeRoutes);
app.route("/annotations", annotationsRoutes);
app.route("/comment", commentRoutes);
app.route("/stt", sttRoutes);
app.get("/stt/mistral-stream", createMistralStreamWsHandler(upgradeWebSocket as never));

app.get("/", (c) => {
  return c.json({ ok: true, message: "MediaGuard API" });
});

const port = Number(process.env.PORT) || 3000;

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`MediaGuard API listening on http://localhost:${info.port}`);
});

injectWebSocket(server);
