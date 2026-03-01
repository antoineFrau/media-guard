import type { TranscriptSegment } from "./types.js";
import { buildAnalysisSystemPrompt } from "../prompts/mistral-system.js";
import { loadSkills, buildSkillsContext } from "./skills.js";

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-small-latest";

let cachedSkillsContext: string | null = null;

async function getSkillsContext(): Promise<string> {
  if (cachedSkillsContext !== null) return cachedSkillsContext;
  const skills = await loadSkills(undefined, 5);
  cachedSkillsContext = buildSkillsContext(skills);
  console.log(`[MediaGuard API] Loaded ${skills.length} skills for Mistral context`);
  return cachedSkillsContext;
}

interface MistralMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface MistralResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
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

export async function analyzeTranscript(
  transcript: TranscriptSegment[],
  apiKey: string
): Promise<AnalysisOutput | null> {
  const transcriptText = transcript
    .map((s) => `[${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] ${s.text}`)
    .join("\n");

  const skillsContext = await getSkillsContext();
  const systemPrompt = buildAnalysisSystemPrompt(skillsContext);

  const messages: MistralMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Analyze this video transcript and identify any rhetorical manipulation or fact-checkable claims. Return valid JSON only.\n\n${transcriptText}`,
    },
  ];

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
      max_tokens: 4096,
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
    const parsed = JSON.parse(content) as AnalysisOutput;
    return {
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
      fact_checks: Array.isArray(parsed.fact_checks) ? parsed.fact_checks : [],
    };
  } catch {
    return null;
  }
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
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    console.error("Mistral improve API error:", res.status, await res.text());
    return null;
  }

  const data = (await res.json()) as MistralResponse;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    return JSON.parse(content) as ImprovedAnnotation;
  } catch {
    return null;
  }
}
