/**
 * Builds the Mistral prompt for Phase 1: skill selection.
 * Selects which manipulation techniques are most relevant for the transcript.
 */

export interface SkillCatalogEntry {
  slug: string;
  name: string;
  description: string;
}

export function buildSkillSelectionSystemPrompt(skillCatalog: SkillCatalogEntry[]): string {
  const skillsList = skillCatalog
    .map((s) => `- **${s.name}** (slug: \`${s.slug}\`): ${s.description}`)
    .join("\n");

  return `You are an expert analyst of media and political discourse. Your task is to select which manipulation techniques (skills) are most likely relevant for analyzing a given transcript.

## Available techniques

${skillsList}

## Instructions

Given the transcript, select 3–8 skills that are most likely to appear or be useful for analyzing this content. Consider:
- The topic and domain (politics, media, debate, etc.)
- The rhetorical style and argumentation patterns
- The type of discourse (persuasive, informative, polemical, etc.)

## Output format

Return valid JSON only:

{
  "selected_skills": ["slug1", "slug2", "slug3"],
  "reasoning": "Brief justification for your selection"
}

- Use only the **slug** values from the list above (e.g. montee-en-generalite, fausse-symmetrie).
- Do not invent slugs. Only use slugs from the provided list.
- Return ONLY the JSON object. No markdown, no code fences, no extra text.`;
}

export function buildSkillSelectionUserPrompt(transcriptExcerpt: string): string {
  return `Analyze this transcript excerpt and select the most relevant manipulation techniques to detect.\n\n${transcriptExcerpt}`;
}
