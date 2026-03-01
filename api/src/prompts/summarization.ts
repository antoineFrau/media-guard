/**
 * Builds the Mistral prompt for Phase 2: summarization and context extraction.
 * Extracts structured context to guide the detection phase.
 */

export function buildSummarizationSystemPrompt(): string {
  return `You are an expert analyst of media and political discourse. Your task is to summarize a video transcript and extract structured context that will help identify rhetorical manipulation and fact-checkable claims.

## Instructions

Analyze the transcript and extract:
1. **Summary**: A 2–3 sentence overview of the main content and argument
2. **Main topics**: Key topics or themes discussed
3. **Key entities**: Important people, organizations, events, or concepts mentioned
4. **Argument structure**: How the argument unfolds (e.g. problem-solution, comparison, narrative)
5. **Notable claims**: Verifiable factual claims that may be worth checking (statistics, dates, events, attributions)

Focus on content that could harbor manipulation techniques or factual errors. Keep entities and claims specific and actionable.

## Output format

Return valid JSON only:

{
  "summary": "2-3 sentence overview of the content",
  "main_topics": ["topic1", "topic2"],
  "key_entities": ["person/organization/event mentioned"],
  "argument_structure": "Brief description of how the argument unfolds",
  "notable_claims": ["Verifiable factual claim 1", "Verifiable claim 2"]
}

- Use empty arrays if no relevant items for a field.
- Return ONLY the JSON object. No markdown, no code fences, no extra text.`;
}

export function buildSummarizationUserPrompt(transcriptText: string): string {
  return `Summarize this video transcript and extract context for manipulation detection.\n\n${transcriptText}`;
}
