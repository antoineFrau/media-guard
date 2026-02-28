#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchChannelVideosWithTranscripts } from "./youtube.js";
import { extractTechniques, generateSkillMd } from "./mistral.js";
import { searchPapers } from "./semantic-scholar.js";
import type { TechniqueWithSources, ProblemsDb } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");
const SKILLS_DIR = join(OUTPUT_DIR, "skills");
const PROBLEMS_FILE = join(OUTPUT_DIR, "problems.json");

async function main() {
  const args = process.argv.slice(2);
  const lastN = parseInt(args.find((a) => a.startsWith("--last="))?.split("=")[1] ?? "10", 10);

  const mistralKey = process.env.MISTRAL_API_KEY;
  if (!mistralKey) {
    console.error("Error: MISTRAL_API_KEY environment variable is required.");
    process.exit(1);
  }

  const s2Key = process.env.S2_API_KEY;

  console.log("Fetching channel videos and transcripts...");
  const videos = await fetchChannelVideosWithTranscripts(lastN);
  console.log(`Fetched ${videos.length} videos with transcripts.`);

  if (videos.length === 0) {
    console.error("No videos with transcripts found. Exiting.");
    process.exit(1);
  }

  console.log("Extracting manipulation techniques with Mistral...");
  const techniques = await extractTechniques(mistralKey, videos);
  console.log(`Extracted ${techniques.length} techniques.`);

  const techniquesWithSources: TechniqueWithSources[] = [];

  for (let i = 0; i < techniques.length; i++) {
    const technique = techniques[i]!;
    console.log(`  Processing: ${technique.name}`);

    if (i > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
    const sources = await searchPapers(technique.name, 5, s2Key).catch((err) => {
      console.warn(`    S2 search failed for ${technique.name}:`, err.message);
      return [];
    });

    const skillPath = `skills/${technique.slug}/SKILL.md`;
    techniquesWithSources.push({
      ...technique,
      sources,
      skillPath,
    });

    const skillDir = join(SKILLS_DIR, technique.slug);
    await mkdir(skillDir, { recursive: true });

    const skillContent = await generateSkillMd(mistralKey, technique, sources);
    const skillFilePath = join(skillDir, "SKILL.md");
    await writeFile(skillFilePath, skillContent, "utf-8");
    console.log(`    Wrote ${skillFilePath}`);
  }

  const db: ProblemsDb = {
    generatedAt: new Date().toISOString(),
    channel: { handle: "@Clemovitch", name: "Clément Viktorovitch" },
    videosProcessed: videos.map((v) => v.videoId),
    techniques: techniquesWithSources,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(PROBLEMS_FILE, JSON.stringify(db, null, 2), "utf-8");
  console.log(`\nWrote ${PROBLEMS_FILE}`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
