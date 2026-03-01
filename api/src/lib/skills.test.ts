import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildSkillCatalog,
  buildSkillsContext,
  getSkillsContextForSlugs,
  type LoadedSkill,
} from "./skills.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_SKILLS_DIR = join(__dirname, "__fixtures__", "skills");

const sampleSkills: LoadedSkill[] = [
  {
    slug: "montee-en-generalite",
    name: "Montée en généralité",
    description: "Generalizing from specific cases.",
    howToRecognize: "Look for specific-to-general.",
    examples: "Example 1",
  },
  {
    slug: "fausse-symmetrie",
    name: "Fausse symétrie",
    description: "False equivalence.",
    howToRecognize: "Look for false balance.",
    examples: "Example 2",
  },
  {
    slug: "appel-a-la-peur",
    name: "Appel à la peur",
    description: "Fear-based persuasion.",
    howToRecognize: "Look for fear appeals.",
    examples: "Example 3",
  },
];

describe("skills module", () => {
  describe("buildSkillCatalog", () => {
    it("returns slug, name, description only", () => {
      const catalog = buildSkillCatalog(sampleSkills);
      expect(catalog).toHaveLength(3);
      expect(catalog[0]).toEqual({
        slug: "montee-en-generalite",
        name: "Montée en généralité",
        description: "Generalizing from specific cases.",
      });
    });
  });

  describe("buildSkillsContext", () => {
    it("includes name, slug, description, howToRecognize, examples", () => {
      const ctx = buildSkillsContext(sampleSkills);
      expect(ctx).toContain("Montée en généralité");
      expect(ctx).toContain("montee-en-generalite");
      expect(ctx).toContain("Generalizing from specific cases.");
      expect(ctx).toContain("**How to recognize:**");
      expect(ctx).toContain("Look for specific-to-general.");
      expect(ctx).toContain("**Examples:**");
    });

    it("returns empty string for empty skills", () => {
      expect(buildSkillsContext([])).toBe("");
    });
  });

  describe("getSkillsContextForSlugs", () => {
    it("filters to requested slugs only", async () => {
      const ctx = await getSkillsContextForSlugs(
        ["montee-en-generalite", "appel-a-la-peur"],
        FIXTURES_SKILLS_DIR
      );

      expect(ctx).toContain("montee-en-generalite");
      expect(ctx).toContain("appel-a-la-peur");
      expect(ctx).not.toContain("fausse-symmetrie");
    });

    it("uses all skills when slugs is empty", async () => {
      const ctx = await getSkillsContextForSlugs([], FIXTURES_SKILLS_DIR);

      expect(ctx).toContain("montee-en-generalite");
      expect(ctx).toContain("fausse-symmetrie");
      expect(ctx).toContain("appel-a-la-peur");
    });

    it("is case-insensitive for slug matching", async () => {
      const ctx = await getSkillsContextForSlugs(
        ["MONTEE-EN-GENERALITE"],
        FIXTURES_SKILLS_DIR
      );

      expect(ctx).toContain("montee-en-generalite");
    });

    it("falls back to all skills when no slugs match", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const ctx = await getSkillsContextForSlugs(
        ["nonexistent-skill"],
        FIXTURES_SKILLS_DIR
      );

      expect(ctx).toContain("montee-en-generalite");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("No matching skills")
      );
      consoleSpy.mockRestore();
    });

    it("returns empty string when skills dir does not exist", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const ctx = await getSkillsContextForSlugs(
        ["any"],
        "/nonexistent/path"
      );
      warnSpy.mockRestore();
      expect(ctx).toBe("");
    });
  });
});
