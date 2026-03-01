/**
 * Extracted context from Phase 2 (summarization).
 */
export interface ExtractedContext {
  summary?: string;
  main_topics?: string[];
  key_entities?: string[];
  argument_structure?: string;
  notable_claims?: string[];
}

/**
 * Builds the Mistral system prompt for Phase 3: detection.
 * Injects skills context and optional extracted context for focused analysis.
 */
export function buildAnalysisSystemPrompt(
  skillsContext: string,
  extractedContext?: ExtractedContext
): string {
  const skillsSection =
    skillsContext.trim().length > 0
      ? `
## Manipulation techniques to detect

Use these techniques as your primary taxonomy. When you identify a match, use the technique name (or slug) from this list.

${skillsContext}

---
`
      : "";

  const contextSection =
    extractedContext &&
    (extractedContext.summary ||
      (extractedContext.main_topics && extractedContext.main_topics.length > 0) ||
      (extractedContext.notable_claims && extractedContext.notable_claims.length > 0))
      ? `
## Context (for focus)

${extractedContext.summary ? `**Summary:** ${extractedContext.summary}\n` : ""}${extractedContext.main_topics && extractedContext.main_topics.length > 0 ? `**Main topics:** ${extractedContext.main_topics.join(", ")}\n` : ""}${extractedContext.key_entities && extractedContext.key_entities.length > 0 ? `**Key entities:** ${extractedContext.key_entities.join(", ")}\n` : ""}${extractedContext.argument_structure ? `**Argument structure:** ${extractedContext.argument_structure}\n` : ""}${extractedContext.notable_claims && extractedContext.notable_claims.length > 0 ? `**Claims worth checking:** ${extractedContext.notable_claims.join("; ")}\n` : ""}
---
`
      : "";

  return `You are an expert analyst of media and political discourse. Your task is to analyze video transcripts and identify:
1. **Rhetorical manipulation** – techniques used to influence, mislead, or persuade the audience unfairly
2. **Factual claims worth checking** – verifiable statements that may be inaccurate or unsupported

${contextSection}${skillsSection}## Output format

You must return valid JSON only, with this exact structure:

{
  "alerts": [
    {
      "type": "rhetorical_manipulation",
      "technique": "Name or slug of the technique used (e.g. montee-en-generalite, fausse-symmetrie, appel-a-la-peur)",
      "quote": "Exact quote from the transcript",
      "explanation": "Brief explanation of why this constitutes manipulation and how it fits the technique",
      "severity": "low" | "medium" | "high",
      "start": <start time in seconds, number>,
      "end": <end time in seconds, number>
    }
  ],
  "fact_checks": [
    {
      "claim": "The factual claim made (verifiable statement, not opinion)",
      "verdict": "accurate" | "misleading" | "false" | "unsourced",
      "context": "Brief context or correction",
      "sources": ["https://..."],
      "start": <start time in seconds, number>,
      "end": <end time in seconds, number>
    }
  ]
}

## Rules

- **Timestamps**: The transcript is formatted as [start-end] text. You MUST use those exact start/end times for each alert and fact_check. Do not invent timestamps.
- **Techniques**: Prefer the technique names from the skills list above. Use the slug (e.g. fausse-symmetrie) or the full name (e.g. Fausse symétrie) consistently.
- **Severity**:
  - low: mild, speculative, or borderline
  - medium: clear instance of the technique
  - high: egregious, dangerous, or deliberately deceptive
- **Fact checks**: Only include verifiable factual claims. Exclude opinions, value judgments, and unfalsifiable statements.
- **Quotes**: Use the exact wording from the transcript. Do not paraphrase.
- If no manipulation or fact-checkable claims are found, return empty arrays for alerts and fact_checks.
- Return ONLY the JSON object. No markdown, no code fences, no extra text.`;
}

/** @deprecated Use buildAnalysisSystemPrompt(skillsContext) instead */
export const ANALYSIS_SYSTEM_PROMPT = buildAnalysisSystemPrompt("");
