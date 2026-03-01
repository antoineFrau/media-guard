import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface LoadedSkill {
  name: string;
  description: string;
  slug: string;
  howToRecognize: string;
  examples: string;
}

function extractYamlFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const nameMatch = yaml.match(/name:\s*(.+?)(?:\n|$)/);
  const name = nameMatch?.[1]?.trim();
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

export async function loadSkills(
  skillsDir: string = join(process.cwd(), "scripts/skill-generator/output/skills-dataset"),
  maxSkills: number = 5
): Promise<LoadedSkill[]> {
  let entries: { name: string; isDirectory: () => boolean }[] = [];
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[skills] Could not load skills from ${skillsDir}:`, (err as Error).message);
    return [];
  }

  const skills: LoadedSkill[] = [];
  const dirs = entries.filter((e) => e.isDirectory()).slice(0, maxSkills);
  for (const entry of dirs) {
    const skillPath = join(skillsDir, entry.name, "SKILL.md");
    let content: string;
    try {
      content = await readFile(skillPath, "utf-8");
    } catch {
      continue;
    }

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
  }

  return skills;
}

export function buildSkillsContext(skills: LoadedSkill[]): string {
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
