#!/usr/bin/env node
/**
 * Run Langfuse benchmark experiment on media-guard/semeval-validation.
 * Uses the same analysis flow as evaluate.ts (Mistral + skills-dataset).
 * Run: npm run benchmark
 * Requires: LANGFUSE_SECRET_KEY, MISTRAL_API_KEY, synced dataset (npm run benchmark:sync)
 */
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LangfuseClient } from "@langfuse/client";
import {
  formatTranscriptForAnalyzer,
  quoteToCharRange,
  rangesOverlap,
} from "./pseudo-transcript.js";
import { SEMEVAL_TO_SLUG, SLUG_TO_NAME } from "./technique-mapping.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");
const SKILLS_DATASET_DIR = join(OUTPUT_DIR, "skills-dataset");
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-small-latest";
const DATASET_NAME = "media-guard/semeval-validation";

interface LoadedSkill {
  name: string;
  description: string;
  slug: string;
  howToRecognize: string;
  examples: string;
}

interface Alert {
  technique?: string;
  quote?: string;
  start?: number;
  end?: number;
}

interface GoldSpan {
  technique_slug: string;
  start_char: number;
  end_char: number;
  quote: string;
}

function extractYamlFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const nameMatch = yaml.match(/name:\s*(.+?)(?:\n|$)/);
  const name = nameMatch?.[1]?.trim().replace(/^["']|["']$/g, "");
  const descMatch = yaml.match(/description:\s*"([^"]*)"/);
  const description = descMatch?.[1] ?? yaml.match(/description:\s*(.+?)(?:\n|$)/)?.[1]?.trim();
  return { name: name ?? undefined, description: description ?? undefined };
}

function extractSection(content: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`##\\s+${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n##|$)`, "i");
  const match = content.match(regex);
  return match ? match[1].trim() : "";
}

async function loadSkills(skillsDir: string): Promise<LoadedSkill[]> {
  let entries: { name: string; isDirectory: () => boolean }[] = [];
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: LoadedSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, "SKILL.md");
    try {
      const content = await readFile(skillPath, "utf-8");
      const { name, description } = extractYamlFrontmatter(content);
      const howToRecognize = extractSection(content, "How to recognize it");
      const examples = extractSection(content, "Examples");
      skills.push({
        name: name ?? entry.name,
        description: description ?? "",
        slug: entry.name,
        howToRecognize,
        examples,
      });
    } catch {
      /* skip */
    }
  }
  return skills;
}

function buildSkillsContext(skills: LoadedSkill[]): string {
  if (skills.length === 0) return "";
  return skills
    .map(
      (s) =>
        `### ${s.name} (${s.slug})\n` +
        `${s.description}\n` +
        (s.howToRecognize ? `**How to recognize:**\n${s.howToRecognize}\n` : "") +
        (s.examples ? `**Examples:**\n${s.examples}\n` : "")
    )
    .join("\n");
}

function buildAnalysisSystemPrompt(skillsContext: string): string {
  const skillsSection =
    skillsContext.trim().length > 0
      ? `\n## Manipulation techniques to detect\n\nUse these techniques as your primary taxonomy.\n\n${skillsContext}\n\n---\n`
      : "";
  return `You are an expert analyst of media and political discourse. Analyze video transcripts and identify rhetorical manipulation techniques.
${skillsSection}## Output format
Return valid JSON only: { "alerts": [ { "technique": "slug", "quote": "exact quote", "explanation": "...", "severity": "low|medium|high", "start": 0, "end": 1 } ], "fact_checks": [] }
Use the slug from the skills list. Quotes must be exact from transcript. Return ONLY the JSON object.`;
}

function normalizeTechniqueToSlug(predicted: string): string | null {
  const trimmed = predicted.trim();
  const lower = trimmed.toLowerCase().replace(/\s+/g, "-");
  for (const slug of Object.values(SEMEVAL_TO_SLUG)) {
    if (slug === lower || slug === trimmed) return slug;
    if (lower.includes(slug) || slug.includes(lower)) return slug;
  }
  for (const [slug, name] of Object.entries(SLUG_TO_NAME)) {
    const nameNorm = name.toLowerCase().replace(/\s*\/\s*/g, "-").replace(/\s+/g, "-");
    if (slug === lower || nameNorm === lower) return slug;
    if (trimmed.toLowerCase() === name.toLowerCase()) return slug;
  }
  return null;
}

async function runAnalysis(
  apiKey: string,
  transcriptText: string,
  skillsContext: string
): Promise<Alert[]> {
  const systemPrompt = buildAnalysisSystemPrompt(skillsContext);
  const res = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze this transcript. Return valid JSON only.\n\n${transcriptText}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 4096,
    }),
  });
  if (!res.ok) throw new Error(`Mistral API error: ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return [];
  try {
    const parsed = JSON.parse(content) as { alerts?: Alert[] };
    return Array.isArray(parsed.alerts) ? parsed.alerts : [];
  } catch {
    return [];
  }
}

function computeSpanMetrics(
  articleText: string,
  goldSpans: GoldSpan[],
  predictedAlerts: Alert[]
): { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number } {
  const goldMatched = new Set<string>();
  let predMatched = 0;
  for (const pred of predictedAlerts) {
    const quote = pred.quote ?? "";
    const predSlug = normalizeTechniqueToSlug(pred.technique ?? "");
    const predRange = quoteToCharRange(articleText, quote);
    if (!predRange) continue;
    for (const g of goldSpans) {
      const key = `${g.start_char}:${g.end_char}:${g.technique_slug}`;
      if (goldMatched.has(key)) continue;
      const slugMatch = predSlug === g.technique_slug;
      const overlap = rangesOverlap(predRange.startChar, predRange.endChar, g.start_char, g.end_char);
      if (slugMatch && overlap) {
        goldMatched.add(key);
        predMatched++;
        break;
      }
    }
  }
  const tp = goldMatched.size;
  const fp = Math.max(0, predictedAlerts.length - predMatched);
  const fn = goldSpans.length - tp;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = goldSpans.length > 0 ? tp / goldSpans.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, precision, recall, f1 };
}

async function main() {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.error("MISTRAL_API_KEY required");
    process.exit(1);
  }
  if (!process.env.LANGFUSE_SECRET_KEY) {
    console.error("LANGFUSE_SECRET_KEY required. Run: npm run benchmark:sync first.");
    process.exit(1);
  }

  const langfuse = new LangfuseClient();
  const skills = await loadSkills(SKILLS_DATASET_DIR);
  const skillsContext = buildSkillsContext(skills);

  const dataset = await langfuse.dataset.get(encodeURIComponent(DATASET_NAME));
  if (!dataset || !dataset.items?.length) {
    console.error("Dataset not found or empty. Run: npm run benchmark:sync");
    process.exit(1);
  }

  const task = async ({
    input,
    expectedOutput,
  }: {
    input: { transcript: Array<{ text: string; start: number; end: number }>; articleText: string; articleId: string };
    expectedOutput: { spans: GoldSpan[] };
  }) => {
    const transcriptText = formatTranscriptForAnalyzer(input.transcript);
    const alerts = await runAnalysis(apiKey, transcriptText, skillsContext);
    return { alerts };
  };

  const spanEvaluator = async ({
    input,
    output,
    expectedOutput,
  }: {
    input: { articleText: string };
    output: { alerts: Alert[] };
    expectedOutput?: { spans: GoldSpan[] };
  }) => {
    const spans = expectedOutput?.spans ?? [];
    const metrics = computeSpanMetrics(input.articleText, spans, output.alerts);
    return { name: "span_f1", value: metrics.f1, comment: `P=${(metrics.precision * 100).toFixed(0)}% R=${(metrics.recall * 100).toFixed(0)}%` };
  };

  const runEvaluator = async ({ itemResults }: { itemResults: Array<{ evaluations?: Array<{ name: string; value: number }> }> }) => {
    const f1Values = itemResults.flatMap((r) => r.evaluations?.filter((e) => e.name === "span_f1").map((e) => e.value as number) ?? []);
    const avgF1 = f1Values.length > 0 ? f1Values.reduce((a, b) => a + b, 0) / f1Values.length : 0;
    return { name: "avg_f1", value: avgF1, comment: `Average F1: ${(avgF1 * 100).toFixed(1)}%` };
  };

  console.log("Running benchmark on", dataset.items.length, "items...");
  const result = await dataset.runExperiment({
    name: "MediaGuard Benchmark",
    description: "SemEval validation split",
    task,
    evaluators: [spanEvaluator],
    runEvaluators: [runEvaluator],
    metadata: { skillsDir: SKILLS_DATASET_DIR, model: MODEL },
  });

  console.log(await result.format());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
