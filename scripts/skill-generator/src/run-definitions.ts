#!/usr/bin/env node
/**
 * Build technique-definitions.json from static definitions + SemEval export.
 * Run: npm run definitions
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTechniqueDefinitions } from "./dataset-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");

async function main() {
  const outputPath = join(OUTPUT_DIR, "technique-definitions.json");
  console.log("Building technique definitions...");
  const db = await loadTechniqueDefinitions(outputPath);
  console.log(`Wrote ${outputPath} (${db.techniques.length} techniques)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
