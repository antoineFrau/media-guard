import type { TranscriptSegment } from "./types.js";
import type { LangfuseTrace } from "./langfuse.js";
import { traceMistralCall } from "./langfuse.js";
import { buildAnalysisSystemPrompt, type ExtractedContext } from "../prompts/mistral-system.js";
import {
  buildSkillSelectionSystemPrompt,
  buildSkillSelectionUserPrompt,
} from "../prompts/skill-selection.js";
import {
  buildSummarizationSystemPrompt,
  buildSummarizationUserPrompt,
} from "../prompts/summarization.js";
import {
  loadSkills,
  buildSkillCatalog,
  buildSkillsContext,
  getSkillsContextForSlugs,
} from "./skills.js";

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-small-latest";

/** Max chars for Phase 1 transcript excerpt (~20k to stay within context). */
const SKILL_SELECTION_TRANSCRIPT_MAX_CHARS = 20_000;

/** Multi-phase is default; set to "false" to use legacy single-shot. */
const ENABLE_MULTI_PHASE = process.env.ENABLE_MULTI_PHASE_ANALYSIS !== "false";

interface MistralMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface MistralResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
}

function formatTranscriptText(transcript: TranscriptSegment[]): string {
  return transcript
    .map((s) => `[${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] ${s.text}`)
    .join("\n");
}

async function callMistralJson<T>(
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  maxTokens = 4096,
  trace: LangfuseTrace | null = null,
  phaseName = "mistral-call"
): Promise<T | null> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userContent },
  ];

  return traceMistralCall(trace, phaseName, messages, async () => {
    const res = await fetch(MISTRAL_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      console.error("Mistral API error:", res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as MistralResponse;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    try {
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  });
}

/** Phase 1: Select relevant skills for the transcript. */
async function selectSkillsForTranscript(
  transcriptText: string,
  apiKey: string,
  trace: LangfuseTrace | null
): Promise<string[]> {
  const allSkills = await loadSkills(undefined, undefined);
  if (allSkills.length === 0) {
    console.warn("[mistral] No skills loaded, Phase 1 will return empty");
    return [];
  }

  const catalog = buildSkillCatalog(allSkills);
  const systemPrompt = buildSkillSelectionSystemPrompt(catalog);

  const excerpt =
    transcriptText.length > SKILL_SELECTION_TRANSCRIPT_MAX_CHARS
      ? transcriptText.slice(0, SKILL_SELECTION_TRANSCRIPT_MAX_CHARS) +
        "\n\n[... transcript truncated for skill selection ...]"
      : transcriptText;

  const userPrompt = buildSkillSelectionUserPrompt(excerpt);
  const result = await callMistralJson<{ selected_skills?: string[] }>(
    apiKey,
    systemPrompt,
    userPrompt,
    1024,
    trace,
    "skill-selection"
  );

  if (!result || !Array.isArray(result.selected_skills)) {
    console.warn("[mistral] Phase 1 returned invalid response, using all skills");
    return allSkills.map((s) => s.slug);
  }

  return result.selected_skills;
}

/** Phase 2: Summarize and extract context. */
async function summarizeAndExtractContext(
  transcriptText: string,
  apiKey: string,
  trace: LangfuseTrace | null
): Promise<ExtractedContext | null> {
  const systemPrompt = buildSummarizationSystemPrompt();
  const userPrompt = buildSummarizationUserPrompt(transcriptText);
  const result = await callMistralJson<ExtractedContext>(
    apiKey,
    systemPrompt,
    userPrompt,
    2048,
    trace,
    "summarization"
  );
  return result;
}

/** Phase 3: Detection with selected skills and extracted context. */
async function runDetectionPhase(
  transcriptText: string,
  selectedSkills: string[],
  extractedContext: ExtractedContext | null,
  apiKey: string,
  trace: LangfuseTrace | null
): Promise<AnalysisOutput | null> {
  const skillsContext = await getSkillsContextForSlugs(selectedSkills);
  const systemPrompt = buildAnalysisSystemPrompt(skillsContext, extractedContext ?? undefined);
  const userContent = `Analyze this video transcript and identify any rhetorical manipulation or fact-checkable claims. Return valid JSON only.\n\n${transcriptText}`;
  return callMistralJson<AnalysisOutput>(apiKey, systemPrompt, userContent, 4096, trace, "detection");
}

export interface AnalysisOutput {
  alerts: Array<{
    type?: string;
    technique?: string;
    quote?: string;
    explanation?: string;
    severity?: string;
    start?: number;
    end?: number;
  }>;
  fact_checks: Array<{
    claim?: string;
    verdict?: string;
    context?: string;
    sources?: string[];
    start?: number;
    end?: number;
  }>;
}

/** Multi-phase analysis: skill selection → summarization → detection. */
async function analyzeTranscriptMultiPhase(
  transcript: TranscriptSegment[],
  apiKey: string,
  trace: LangfuseTrace | null
): Promise<AnalysisOutput | null> {
  const transcriptText = formatTranscriptText(transcript);

  const [selectedSkills, extractedContext] = await Promise.all([
    selectSkillsForTranscript(transcriptText, apiKey, trace),
    summarizeAndExtractContext(transcriptText, apiKey, trace),
  ]);

  if (selectedSkills.length === 0) {
    console.warn("[mistral] Phase 1 returned no skills, using all skills for Phase 3");
  }

  const analysis = await runDetectionPhase(
    transcriptText,
    selectedSkills.length > 0 ? selectedSkills : [],
    extractedContext,
    apiKey,
    trace
  );

  if (analysis) {
    return {
      alerts: Array.isArray(analysis.alerts) ? analysis.alerts : [],
      fact_checks: Array.isArray(analysis.fact_checks) ? analysis.fact_checks : [],
    };
  }
  return null;
}

/** Legacy single-shot analysis (used when ENABLE_MULTI_PHASE_ANALYSIS=false). */
async function analyzeTranscriptLegacy(
  transcript: TranscriptSegment[],
  apiKey: string,
  trace: LangfuseTrace | null
): Promise<AnalysisOutput | null> {
  const transcriptText = formatTranscriptText(transcript);
  const allSkills = await loadSkills(undefined, 5);
  const skillsContext = buildSkillsContext(allSkills);
  const systemPrompt = buildAnalysisSystemPrompt(skillsContext);
  const userContent = `Analyze this video transcript and identify any rhetorical manipulation or fact-checkable claims. Return valid JSON only.\n\n${transcriptText}`;
  const result = await callMistralJson<AnalysisOutput>(apiKey, systemPrompt, userContent, 4096, trace, "detection");
  if (result) {
    return {
      alerts: Array.isArray(result.alerts) ? result.alerts : [],
      fact_checks: Array.isArray(result.fact_checks) ? result.fact_checks : [],
    };
  }
  return null;
}

export async function analyzeTranscript(
  transcript: TranscriptSegment[],
  apiKey: string,
  trace: LangfuseTrace | null = null
): Promise<AnalysisOutput | null> {
  if (ENABLE_MULTI_PHASE) {
    return analyzeTranscriptMultiPhase(transcript, apiKey, trace);
  }
  return analyzeTranscriptLegacy(transcript, apiKey, trace);
}

export interface ImprovedAnnotation {
  content?: string;
  explanation?: string;
  sources?: string[];
}

export async function improveAnnotationWithMistral(
  currentContent: string,
  currentExplanation: string,
  currentSources: string[],
  userComment: string,
  apiKey: string
): Promise<ImprovedAnnotation | null> {
  const systemPrompt = `You improve fact-check annotations based on user comments.
Return valid JSON only:
{
  "content": "Updated claim/content if needed",
  "explanation": "Updated or augmented explanation",
  "sources": ["url1", "url2"]
}
Incorporate the user's comment if it adds valid information. Keep existing content if the comment doesn't improve it. Return only the JSON object.`;

  const userPrompt = `Current fact-check:
- Content: ${currentContent}
- Explanation: ${currentExplanation}
- Sources: ${currentSources.join(", ") || "none"}

User adds: ${userComment}

Return the improved JSON.`;

  return callMistralJson<ImprovedAnnotation>(apiKey, systemPrompt, userPrompt, 1024);
}
