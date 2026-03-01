import type { Context } from "hono";
import { runMistralTranscription } from "./stt.js";

/** WebSocket route handler for Mistral real-time transcription - use with upgradeWebSocket from @hono/node-ws */
export function createMistralStreamWsHandler(
  // upgradeWebSocket(cb) returns a route handler
  upgradeWebSocket: (createEvents: (c: Context) => object) => (c: Context) => Response
): (c: Context) => Response {
  return (c: Context): Response => {
    const apiKey =
      c.req.query("api_key") ??
      c.req.header("X-Mistral-API-Key") ??
      process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      return c.json(
        {
          reason: "mistral_not_configured",
          message: "Provide api_key query param, X-Mistral-API-Key header, or MISTRAL_API_KEY env.",
        },
        401
      );
    }
    const state: {
      push: ((m: { data: string } | null) => void) | null;
      end: (() => void) | null;
    } = { push: null, end: null };
    const wsHandler = upgradeWebSocket((ctx) => ({
      onOpen(_ev: Event, ws: { send: (data: string | ArrayBuffer) => void }) {
        const queue: { data: string }[] = [];
        let resolveNext: ((v: { data: string } | null) => void) | null = null;
        const getNext = () =>
          new Promise<{ data: string } | null>((resolve) => {
            if (queue.length > 0) resolve(queue.shift() ?? null);
            else resolveNext = resolve;
          });
        const push = (msg: { data: string } | null) => {
          if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            r(msg);
          } else if (msg) queue.push(msg);
        };
        state.push = push;
        state.end = () => push(null);
        runMistralTranscription(apiKey, { getNext }, (obj) => {
          try {
            ws.send(JSON.stringify(obj));
          } catch (_) {}
        }).catch(() => {});
      },
      onMessage(ev: MessageEvent) {
        try {
          const raw = typeof ev.data === "string" ? ev.data : "";
          const msg = JSON.parse(raw) as { type?: string; data?: string };
          if (msg.type === "audio" && typeof msg.data === "string") state.push?.({ data: msg.data });
          else if (msg.type === "end") state.end?.();
        } catch (_) {}
      },
      onClose() {
        state.end?.();
      },
    }));
    return wsHandler(c);
  };
}
