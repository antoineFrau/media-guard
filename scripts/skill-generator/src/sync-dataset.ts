#!/usr/bin/env node
/**
 * Sync SemEval export to Langfuse datasets (media-guard/semeval-{split}).
 * Run: npm run benchmark:sync
 * Requires: LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY (optional), semeval-export.json
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LangfuseClient } from "@langfuse/client";
import { articleToTranscript } from "./pseudo-transcript.js";
import type { SemEvalArticle, SemEvalExport } from "./dataset-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

const DATASET_PREFIX = "media-guard/semeval";

async function loadSemEvalExport(): Promise<SemEvalExport> {
  const path = join(DATA_DIR, "semeval-export.json");
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as SemEvalExport;
}

function articleToDatasetItem(article: SemEvalArticle) {
  const { segments } = articleToTranscript(article.text);
  return {
    id: article.article_id,
    input: {
      transcript: segments,
      articleId: article.article_id,
      articleText: article.text,
    },
    expectedOutput: {
      spans: article.spans.map((s) => ({
        technique_slug: s.technique_slug,
        start_char: s.start_char,
        end_char: s.end_char,
        quote: s.quote,
      })),
    },
  };
}

async function main() {
  if (!process.env.LANGFUSE_SECRET_KEY) {
    console.error("LANGFUSE_SECRET_KEY is required. Set it in .env or the environment.");
    process.exit(1);
  }

  const semeval = await loadSemEvalExport();
  const langfuse = new LangfuseClient();

  const splits = ["train", "validation", "test"] as const;
  for (const split of splits) {
    const splitKey = split === "validation" && !("validation" in semeval.splits) && "val" in semeval.splits ? "val" : split;
    const articles = semeval.splits[splitKey] ?? semeval.splits.train ?? [];
    if (articles.length === 0) {
      console.log(`Skipping ${split}: no articles`);
      continue;
    }

    const datasetName = `${DATASET_PREFIX}-${split}`;
    console.log(`Syncing ${datasetName} (${articles.length} items)...`);

    try {
      await langfuse.api.datasets.create({
        name: datasetName,
        description: `SemEval propaganda technique spans (${split} split)`,
        metadata: { source: "semeval-export.json", split },
      });
    } catch (err) {
      if (String(err).includes("already exists") || (err as { code?: string })?.code === "CONFLICT") {
        console.log(`  Dataset ${datasetName} already exists, upserting items`);
      } else {
        throw err;
      }
    }

    for (const article of articles) {
      const item = articleToDatasetItem(article);
      try {
        await langfuse.api.datasetItems.create({
          datasetName,
          id: item.id,
          input: item.input,
          expectedOutput: item.expectedOutput,
          metadata: { articleId: article.article_id },
        });
        console.log(`  + ${item.id}`);
      } catch (err) {
        console.error(`  Failed ${item.id}:`, err);
      }
    }

    console.log(`  Done ${datasetName}`);
  }

  console.log("\nSync complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
