import { Mistral } from "@mistralai/mistralai";
import {
  ExtractionResultSchema,
  type ExtractedTechnique,
  type PaperSource,
} from "./types.js";

const MODEL = "mistral-small-latest";

function formatTranscriptForAnalysis(
  videos: { videoId: string; title: string; transcript: { text: string; start: number; end: number }[] }[]
): string {
  return videos
    .map((v) => {
      const segments = v.transcript
        .map((s) => `[${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] ${s.text}`)
        .join("\n");
      return `--- Video: ${v.title} (ID: ${v.videoId}) ---\n${segments}`;
    })
    .join("\n\n");
}

/**
 * Extract manipulation techniques from video transcripts using Mistral.
 */
export async function extractTechniques(
  apiKey: string,
  videos: { videoId: string; title: string; transcript: { text: string; start: number; end: number }[] }[]
): Promise<ExtractedTechnique[]> {
  const client = new Mistral({ apiKey });
  const transcriptText = formatTranscriptForAnalysis(videos);

  // Truncate if too long (Mistral context limit)
  const maxChars = 120_000;
  const truncated =
    transcriptText.length > maxChars
      ? transcriptText.slice(0, maxChars) + "\n\n[... transcript truncated ...]"
      : transcriptText;

  const systemPrompt = `You analyze transcripts from YouTube videos by Clément Viktorovitch, a political scientist who decodes rhetorical and media manipulation techniques used by politicians and media.

Your task: Extract distinct manipulation techniques, rhetorical tricks, or media/politician tactics that are demonstrated or discussed in these transcripts.

For each technique:
- name: Clear name (in French or English as used in the video)
- slug: URL-safe identifier (lowercase, hyphens, e.g. "appel-a-la-peur")
- description: One paragraph explaining the technique
- examples: Array of { quote, videoId, context? } - actual quotes from the transcript with the video ID
- category: One of rhetoric, bias, factual, framing, other

Focus on techniques that are well-defined and have clear examples. Merge similar techniques. Return 3-15 distinct techniques.`;

  const userPrompt = `Analyze these transcript excerpts and extract manipulation techniques:\n\n${truncated}`;

  const response = await client.chat.complete({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    responseFormat: { type: "json_object" },
    maxTokens: 4096,
    temperature: 0.2,
  });

  const rawContent = response.choices?.[0]?.message?.content;
  if (rawContent == null) {
    throw new Error("Empty response from Mistral");
  }
  const content =
    typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? (rawContent as { text?: string }[]).map((c) => c?.text ?? "").join("")
        : String(rawContent);

  const parsed = JSON.parse(content) as unknown;
  const result = ExtractionResultSchema.safeParse(parsed);
  if (!result.success) {
    console.warn("Mistral response did not match schema, attempting to fix:", result.error.message);
    const fallback = typeof parsed === "object" && parsed !== null && "techniques" in parsed
      ? { techniques: (parsed as { techniques: unknown }).techniques }
      : { techniques: [] };
    const fixed = ExtractionResultSchema.safeParse(fallback);
    if (!fixed.success) {
      throw new Error(`Failed to parse Mistral response: ${result.error.message}`);
    }
    return fixed.data.techniques;
  }
  return result.data.techniques;
}

/**
 * Generate a SKILL.md file for a technique, backed by research papers.
 */
export async function generateSkillMd(
  apiKey: string,
  technique: ExtractedTechnique,
  sources: PaperSource[]
): Promise<string> {
  const client = new Mistral({ apiKey });

  const sourcesContext = sources
    .map(
      (s) =>
        `- ${s.title} (${s.year ?? "n.d."}): ${s.abstract ?? "No abstract"} | URL: ${s.url}`
    )
    .join("\n");

  const examplesContext = technique.examples
    .map((e) => `- "${e.quote}" (video: ${e.videoId})${e.context ? ` - ${e.context}` : ""}`)
    .join("\n");

  const systemPrompt = `You generate Cursor SKILL.md files that teach an AI agent to recognize and analyze media/political manipulation techniques.

Output format:
1. YAML frontmatter with name (lowercase-hyphenated) and description (third person, max 1024 chars)
2. Sections: What it is, How to recognize it, Examples, Research backing (cite the papers)
3. Concise, under 300 lines total
4. Description must be specific and include trigger terms for when to use this skill`;

  const userPrompt = `Generate a SKILL.md for this manipulation technique:

**Technique:** ${technique.name}
**Description:** ${technique.description}
**Category:** ${technique.category}

**Examples from videos:**
${examplesContext}

**Research papers to cite:**
${sourcesContext}

Output the complete SKILL.md content only.`;

  const response = await client.chat.complete({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 4096,
    temperature: 0.3,
  });

  const rawContent = response.choices?.[0]?.message?.content;
  if (rawContent == null) {
    throw new Error("Empty SKILL.md response from Mistral");
  }
  return typeof rawContent === "string"
    ? rawContent
    : Array.isArray(rawContent)
      ? (rawContent as { text?: string }[]).map((c) => c?.text ?? "").join("")
      : String(rawContent);
}
