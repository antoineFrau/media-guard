#!/usr/bin/env node
/**
 * Benchmark: evaluate both dataset-backed and YouTube-derived agents on 50-item eval set.
 * Optionally uses LLM-as-judge for semantic correctness.
 *
 * Run: npm run evaluate:benchmark
 * Or: npx tsx src/evaluate-benchmark.ts [--judge] [--limit=50]
 */
import "dotenv/config";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEvalSamples } from "./dataset-loader.js";
import {
  articleToTranscript,
  formatTranscriptForAnalyzer,
  quoteToCharRange,
  rangesOverlap,
} from "./pseudo-transcript.js";
import { SEMEVAL_TO_SLUG, SLUG_TO_NAME } from "./technique-mapping.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");
const SKILLS_DATASET_DIR = join(OUTPUT_DIR, "skills-dataset");
const SKILLS_YOUTUBE_DIR = join(OUTPUT_DIR, "skills");

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-small-latest";

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

interface EvalResult {
  agent: string;
  samplesProcessed: number;
  totalGoldSpans: number;
  totalPredicted: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1: number;
  judgeScore?: number;
  judgeDetails?: Array<{ articleId: string; score: number; explanation?: string }>;
  perTechnique?: Record<string, { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number }>;
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
      ? `\n## Manipulation techniques to detect\n\nUse these techniques as your primary taxonomy. When you identify a match, use the technique name (or slug) from this list.\n\n${skillsContext}\n\n---\n`
      : "";

  return `You are an expert analyst of media and political discourse. Your task is to analyze video transcripts and identify rhetorical manipulation techniques.

${skillsSection}## Output format

You must return valid JSON only:
{
  "alerts": [
    {
      "type": "rhetorical_manipulation",
      "technique": "slug or name from the skills list (e.g. appeal-to-authority, loaded-language)",
      "quote": "Exact quote from the transcript",
      "explanation": "Brief explanation",
      "severity": "low" | "medium" | "high",
      "start": <number>,
      "end": <number>
    }
  ],
  "fact_checks": []
}

## Rules
- Use the slug (e.g. appeal-to-authority) or full name from the skills list for technique.
- Timestamps: transcript is [start-end] text. Use those exact start/end for each alert.
- Quotes: exact wording from transcript.
- If no manipulation found, return empty alerts array.
- Return ONLY the JSON object. No markdown, no code fences.`;
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
        {
          role: "user",
          content: `Analyze this transcript and identify rhetorical manipulation. Return valid JSON only.\n\n${transcriptText}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    throw new Error(`Mistral API error: ${res.status} ${await res.text()}`);
  }

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

async function runLLMJudge(
  apiKey: string,
  articleId: string,
  text: string,
  goldSpans: Array<{ quote: string; technique_slug: string }>,
  predictedAlerts: Array<{ quote?: string; technique?: string }>
): Promise<{ score: number; explanation?: string }> {
  const goldStr = goldSpans.map((g) => `- "${g.quote}" [${g.technique_slug}]`).join("\n");
  const predStr =
    predictedAlerts.length > 0
      ? predictedAlerts.map((p) => `- "${p.quote ?? ""}" [${p.technique ?? ""}]`).join("\n")
      : "(none predicted)";

  const prompt = `You are an expert judge for propaganda technique detection. Compare predicted outputs to the gold standard.

TEXT:
${text.slice(0, 1500)}${text.length > 1500 ? "..." : ""}

GOLD STANDARD (expected correct detections):
${goldStr || "(no gold spans)"}

PREDICTED:
${predStr}

Score the prediction from 0 to 1:
- 1.0: Predicted spans correctly identify the same manipulations as gold (overlapping quote + correct/equivalent technique)
- 0.5-0.9: Partial match (some correct, some missed or wrong)
- 0.0-0.4: Mostly wrong or missed

Return JSON only: {"score": <0-1>, "explanation": "<brief>"}`;

  const res = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });

  if (!res.ok) return { score: 0 };

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return { score: 0 };

  try {
    const parsed = JSON.parse(content) as { score?: number; explanation?: string };
    const score = typeof parsed.score === "number" ? Math.max(0, Math.min(1, parsed.score)) : 0;
    return { score, explanation: parsed.explanation };
  } catch {
    return { score: 0 };
  }
}

interface ArticleWithSpans {
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

async function evaluateAgent(
  apiKey: string,
  skillsDir: string,
  agentName: string,
  articles: ArticleWithSpans[],
  useJudge: boolean
): Promise<EvalResult> {
  const skills = await loadSkills(skillsDir);
  const skillsContext = buildSkillsContext(skills);

  let totalGold = 0;
  let totalPred = 0;
  const goldMatched = new Set<string>();
  const predMatched = new Set<string>();
  const perTechnique: Record<string, { tp: number; fp: number; fn: number }> = {};
  const initTechnique = (slug: string) => {
    if (!perTechnique[slug]) perTechnique[slug] = { tp: 0, fp: 0, fn: 0 };
  };

  const judgeDetails: Array<{ articleId: string; score: number; explanation?: string }> = [];

  for (const article of articles) {
    const { segments, charMap } = articleToTranscript(article.text);
    const transcriptText = formatTranscriptForAnalyzer(segments);

    const alerts = await runAnalysis(apiKey, transcriptText, skillsContext);

    const goldSpans = article.spans.map((s) => ({
      ...s,
      key: `${article.article_id}:${s.start_char}:${s.end_char}:${s.technique_slug}`,
    }));

    for (const g of goldSpans) {
      totalGold++;
      initTechnique(g.technique_slug);
      perTechnique[g.technique_slug]!.fn++;
    }

    for (const pred of alerts) {
      totalPred++;
      const quote = pred.quote ?? "";
      const predSlug = normalizeTechniqueToSlug(pred.technique ?? "");
      const predRange = quoteToCharRange(article.text, quote);

      if (!predRange) continue;

      let matched = false;
      for (const g of goldSpans) {
        if (goldMatched.has(g.key)) continue;
        const slugMatch = predSlug === g.technique_slug;
        const overlap = rangesOverlap(
          predRange.startChar,
          predRange.endChar,
          g.start_char,
          g.end_char
        );
        if (slugMatch && overlap) {
          goldMatched.add(g.key);
          predMatched.add(`${article.article_id}:${predRange.startChar}:${predRange.endChar}`);
          perTechnique[g.technique_slug]!.fn--;
          perTechnique[g.technique_slug]!.tp++;
          matched = true;
          break;
        }
      }
      if (!matched && predSlug && Object.keys(SLUG_TO_NAME).includes(predSlug)) {
        initTechnique(predSlug);
        perTechnique[predSlug]!.fp++;
      }
    }

    if (useJudge && article.spans.length > 0) {
      const judgeResult = await runLLMJudge(
        apiKey,
        article.article_id,
        article.text,
        article.spans.map((s) => ({ quote: s.quote, technique_slug: s.technique_slug })),
        alerts
      );
      judgeDetails.push({
        articleId: article.article_id,
        score: judgeResult.score,
        explanation: judgeResult.explanation,
      });
    }
  }

  const tp = goldMatched.size;
  const fp = totalPred - predMatched.size;
  const fn = totalGold - goldMatched.size;
  const precision = totalPred > 0 ? tp / totalPred : 0;
  const recall = totalGold > 0 ? tp / totalGold : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const perTechniqueResults: Record<string, { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number }> = {};
  for (const [slug, stats] of Object.entries(perTechnique)) {
    const p = stats.fp + stats.tp > 0 ? stats.tp / (stats.tp + stats.fp) : 0;
    const r = stats.fn + stats.tp > 0 ? stats.tp / (stats.tp + stats.fn) : 0;
    perTechniqueResults[slug] = {
      ...stats,
      precision: p,
      recall: r,
      f1: p + r > 0 ? (2 * p * r) / (p + r) : 0,
    };
  }

  const judgeScore =
    judgeDetails.length > 0
      ? judgeDetails.reduce((sum, d) => sum + d.score, 0) / judgeDetails.length
      : undefined;

  return {
    agent: agentName,
    samplesProcessed: articles.length,
    totalGoldSpans: totalGold,
    totalPredicted: totalPred,
    truePositives: tp,
    precision,
    recall,
    f1,
    judgeScore,
    judgeDetails: judgeDetails.length > 0 ? judgeDetails : undefined,
    perTechnique: perTechniqueResults,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const useJudge = args.includes("--judge");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1]!, 10) : 50;

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.error("MISTRAL_API_KEY required");
    process.exit(1);
  }

  let articles = await loadEvalSamples("eval50");
  if (articles.length === 0) {
    articles = await loadEvalSamples("validation");
  }
  const evalArticles = articles.slice(0, limit);

  console.log("MediaGuard Agent Benchmark");
  console.log(`  Eval set: ${evalArticles.length} articles`);
  console.log(`  LLM Judge: ${useJudge ? "enabled" : "disabled"}`);
  console.log("");

  const results: EvalResult[] = [];

  // Agent 1: Dataset-backed skills (SemEval taxonomy)
  console.log("Evaluating dataset-backed agent (skills-dataset)...");
  const datasetResult = await evaluateAgent(
    apiKey,
    SKILLS_DATASET_DIR,
    "skills-dataset",
    evalArticles,
    useJudge
  );
  results.push(datasetResult);

  // Agent 2: YouTube-derived skills (French/ad-hoc taxonomy)
  console.log("Evaluating YouTube-derived agent (skills)...");
  const youtubeResult = await evaluateAgent(
    apiKey,
    SKILLS_YOUTUBE_DIR,
    "skills-youtube",
    evalArticles,
    useJudge
  );
  results.push(youtubeResult);

  // Print results
  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));

  for (const r of results) {
    console.log(`\n${r.agent}:`);
    console.log(`  Samples: ${r.samplesProcessed} | Gold: ${r.totalGoldSpans} | Pred: ${r.totalPredicted}`);
    console.log(`  Precision: ${(r.precision * 100).toFixed(1)}% | Recall: ${(r.recall * 100).toFixed(1)}% | F1: ${(r.f1 * 100).toFixed(1)}%`);
    if (r.judgeScore !== undefined) {
      console.log(`  LLM Judge Score: ${(r.judgeScore * 100).toFixed(1)}%`);
    }
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const outPath = join(OUTPUT_DIR, "benchmark-results.json");
  await writeFile(
    outPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        options: { limit, useJudge, evalSplit: "eval50" },
        results,
      },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
