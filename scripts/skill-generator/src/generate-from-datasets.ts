#!/usr/bin/env node
/**
 * Dataset-driven skill generator.
 * Loads technique definitions from SemEval/PTC, generates SKILL.md via Mistral.
 * Run: npm run generate:datasets
 */
import "dotenv/config";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTechniqueDefinitions } from "./dataset-loader.js";
import { generateSkillFromDefinition } from "./mistral.js";
import { searchPapers } from "./semantic-scholar.js";
import type { TechniqueDefinition } from "./dataset-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");
const SKILLS_DATASET_DIR = join(OUTPUT_DIR, "skills-dataset");
const DEFINITIONS_FILE = join(OUTPUT_DIR, "technique-definitions.json");

async function main() {
  const mistralKey = process.env.MISTRAL_API_KEY;
  if (!mistralKey) {
    console.error("Error: MISTRAL_API_KEY environment variable is required.");
    process.exit(1);
  }

  const s2Key = process.env.S2_API_KEY;

  console.log("Loading technique definitions...");
  let db;
  try {
    const content = await readFile(DEFINITIONS_FILE, "utf-8");
    db = JSON.parse(content) as { techniques: TechniqueDefinition[] };
  } catch {
    console.log("Definitions file not found. Building from static + dataset...");
    db = await loadTechniqueDefinitions(DEFINITIONS_FILE);
  }

  await mkdir(SKILLS_DATASET_DIR, { recursive: true });

  console.log(`Generating skills for ${db.techniques.length} techniques...`);

  for (let i = 0; i < db.techniques.length; i++) {
    const technique = db.techniques[i]!;
    console.log(`  [${i + 1}/${db.techniques.length}] ${technique.name} (${technique.slug})`);

    if (i > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }

    let sources: Array<{ paperId: string; title: string; url: string; year?: number; abstract?: string }> = [];
    try {
      sources = await searchPapers(technique.name, 3, s2Key);
    } catch (err) {
      console.warn(`    S2 search failed:`, (err as Error).message);
    }

    const skillContent = await generateSkillFromDefinition(mistralKey, technique, sources);

    const skillDir = join(SKILLS_DATASET_DIR, technique.slug);
    await mkdir(skillDir, { recursive: true });
    const skillPath = join(skillDir, "SKILL.md");
    await writeFile(skillPath, skillContent, "utf-8");
    console.log(`    Wrote ${skillPath}`);
  }

  console.log("\nDone. Skills written to output/skills-dataset/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
