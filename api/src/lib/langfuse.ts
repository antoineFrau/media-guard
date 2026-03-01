/**
 * Langfuse tracing for the video analysis agent.
 * When LANGFUSE_SECRET_KEY is missing, tracing is no-op.
 */
import {
  startActiveObservation,
  type LangfuseSpan,
  type LangfuseGeneration,
} from "@langfuse/tracing";
import type { TranscriptSegment } from "./types.js";

/** Observation type for passing to analysis (span or generation with startObservation). */
export type LangfuseTrace = LangfuseSpan | LangfuseGeneration;

let otelInitialized = false;

function initOtelIfNeeded(): boolean {
  if (otelInitialized) return !!process.env.LANGFUSE_SECRET_KEY;
  if (!process.env.LANGFUSE_SECRET_KEY) return false;

  try {
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const { LangfuseSpanProcessor } = require("@langfuse/otel");
    const sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
    });
    sdk.start();
    otelInitialized = true;
  } catch {
    return false;
  }
  return true;
}

/**
 * Create a root trace for video analysis and run the analysis function.
 * When Langfuse is not configured, just runs fn without tracing.
 */
export async function traceAnalysis<T>(
  videoId: string,
  transcript: TranscriptSegment[],
  fn: (trace: LangfuseTrace | null) => Promise<T>
): Promise<T> {
  if (!initOtelIfNeeded()) {
    return fn(null);
  }

  return startActiveObservation(
    "video-analysis",
    async (span) => {
      span.update({
        input: { video_id: videoId, segment_count: transcript.length },
        metadata: { video_id: videoId },
      });
      const result = await fn(span);
      span.update({
        output: {
          alerts: (result as { alerts?: unknown }).alerts,
          fact_checks: (result as { fact_checks?: unknown }).fact_checks,
        },
      });
      return result;
    },
    { asType: "span" }
  );
}

/**
 * Create a generation span for a Mistral API call under the given trace.
 * When trace is null, just runs fn without tracing.
 */
export async function traceMistralCall<T>(
  trace: LangfuseTrace | null,
  name: string,
  messages: Array<{ role: string; content: string }>,
  fn: () => Promise<T>
): Promise<T> {
  if (!trace) return fn();

  const generation = trace.startObservation(name, {
    input: messages,
    model: "mistral-small-latest",
  }, { asType: "generation" }) as LangfuseGeneration;

  const start = Date.now();
  try {
    const result = await fn();
    const output = typeof result === "string" ? result : JSON.stringify(result);
    generation.update({
      output: typeof result === "object" ? result : output,
      metadata: { duration_ms: Date.now() - start },
    });
    generation.end();
    return result;
  } catch (err) {
    generation.update({ level: "ERROR", statusMessage: String(err) });
    generation.end();
    throw err;
  }
}
