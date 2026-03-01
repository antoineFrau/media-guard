/**
 * Loads propaganda technique datasets and produces a unified technique-definitions.json.
 * Uses static definitions + optional SemEval export (from Python script).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SEMEVAL_TO_SLUG, SLUG_TO_NAME } from "./technique-mapping.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface TechniqueDefinition {
  slug: string;
  name: string;
  nameFr?: string;
  definition: string;
  example?: string;
  examples?: string[];
  sources: string[];
}

export interface TechniqueDefinitionsDb {
  generatedAt: string;
  techniques: TechniqueDefinition[];
}

export interface SemEvalArticle {
  article_id: string;
  text: string;
  spans: Array<{
    start_char: number;
    end_char: number;
    technique_id: number;
    technique_slug: string;
    quote: string;
  }>;
}

export interface SemEvalExport {
  splits: {
    train?: SemEvalArticle[];
    validation?: SemEvalArticle[];
    val?: SemEvalArticle[];
    test?: SemEvalArticle[];
    eval50?: SemEvalArticle[];
  };
  techniqueExamples?: Record<string, string[]>;
}

/**
 * Load static technique definitions from the PRTA paper.
 */
async function loadStaticDefinitions(): Promise<TechniqueDefinition[]> {
  const path = join(__dirname, "..", "data", "technique-definitions-static.json");
  const content = await readFile(path, "utf-8");
  const data = JSON.parse(content) as { techniques: Array<{ slug: string; name: string; nameFr?: string; definition: string; example?: string }> };
  return data.techniques.map((t) => ({
    slug: t.slug,
    name: t.name,
    nameFr: t.nameFr,
    definition: t.definition,
    example: t.example,
    examples: t.example ? [t.example] : [],
    sources: ["PRTA (ACL 2020)", "SemEval-2020 Task 11"],
  }));
}

/**
 * Load SemEval export if available (from scripts/export-semeval.py).
 */
async function loadSemEvalExport(): Promise<SemEvalExport | null> {
  const path = join(__dirname, "..", "data", "semeval-export.json");
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as SemEvalExport;
  } catch {
    return null;
  }
}

/**
 * Merge dataset examples into technique definitions.
 */
function mergeExamples(
  definitions: TechniqueDefinition[],
  semeval: SemEvalExport | null
): TechniqueDefinition[] {
  if (!semeval?.techniqueExamples) return definitions;

  const bySlug = new Map(definitions.map((d) => [d.slug, { ...d }]));

  for (const [slug, examples] of Object.entries(semeval.techniqueExamples)) {
    const def = bySlug.get(slug);
    if (def && examples.length > 0) {
      def.examples = [...(def.examples ?? []), ...examples].slice(0, 10);
      def.sources = [...new Set([...def.sources, "SemEval PTC"])];
    }
  }

  return Array.from(bySlug.values());
}

/**
 * Ensure all 14 SemEval techniques are present (in case static is incomplete).
 */
function ensureComplete(definitions: TechniqueDefinition[]): TechniqueDefinition[] {
  const bySlug = new Map(definitions.map((d) => [d.slug, d]));

  for (const [id, slug] of Object.entries(SEMEVAL_TO_SLUG)) {
    if (!bySlug.has(slug)) {
      bySlug.set(slug, {
        slug,
        name: SLUG_TO_NAME[slug] ?? slug,
        definition: `Propaganda technique (ID ${id}). See SemEval-2020 Task 11.`,
        examples: [],
        sources: ["SemEval-2020 Task 11"],
      });
    }
  }

  return Array.from(bySlug.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Load and merge all sources into technique-definitions.json.
 */
export async function loadTechniqueDefinitions(
  outputPath?: string
): Promise<TechniqueDefinitionsDb> {
  const definitions = await loadStaticDefinitions();
  const semeval = await loadSemEvalExport();

  if (!semeval) {
    console.warn("[dataset-loader] No semeval-export.json found. Run: python scripts/export-semeval.py");
  }

  const merged = mergeExamples(definitions, semeval);
  const complete = ensureComplete(merged);

  const db: TechniqueDefinitionsDb = {
    generatedAt: new Date().toISOString(),
    techniques: complete,
  };

  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(db, null, 2), "utf-8");
  }

  return db;
}

/**
 * Load evaluation samples (articles with gold spans) for a given split.
 * Use split="eval50" for the full 50-item benchmark set.
 */
export async function loadEvalSamples(
  split: "train" | "validation" | "test" | "eval50" = "validation"
): Promise<SemEvalArticle[]> {
  const semeval = await loadSemEvalExport();
  if (!semeval) {
    throw new Error("Run: python scripts/export-semeval.py to export SemEval data first");
  }

  const splitKey =
    split === "validation"
      ? "validation" in semeval.splits
        ? "validation"
        : "val"
      : split;
  const articles = semeval.splits[splitKey as keyof typeof semeval.splits] ?? semeval.splits.train ?? [];
  return articles;
}
