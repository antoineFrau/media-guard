import { describe, it, expect } from "vitest";
import {
  buildSkillSelectionSystemPrompt,
  buildSkillSelectionUserPrompt,
  type SkillCatalogEntry,
} from "./skill-selection.js";

describe("skill-selection prompts", () => {
  const catalog: SkillCatalogEntry[] = [
    { slug: "montee-en-generalite", name: "Montée en généralité", description: "Generalizing from specific cases." },
    { slug: "fausse-symmetrie", name: "Fausse symétrie", description: "False equivalence between positions." },
    { slug: "appel-a-la-peur", name: "Appel à la peur", description: "Using fear to persuade." },
  ];

  describe("buildSkillSelectionSystemPrompt", () => {
    it("includes all skills from catalog with slug and description", () => {
      const prompt = buildSkillSelectionSystemPrompt(catalog);
      expect(prompt).toContain("montee-en-generalite");
      expect(prompt).toContain("Montée en généralité");
      expect(prompt).toContain("Generalizing from specific cases.");
      expect(prompt).toContain("fausse-symmetrie");
      expect(prompt).toContain("appel-a-la-peur");
    });

    it("instructs to select 3–8 skills", () => {
      const prompt = buildSkillSelectionSystemPrompt(catalog);
      expect(prompt).toMatch(/3–8|3-8/);
    });

    it("requires JSON output with selected_skills and reasoning", () => {
      const prompt = buildSkillSelectionSystemPrompt(catalog);
      expect(prompt).toContain('"selected_skills"');
      expect(prompt).toContain('"reasoning"');
    });

    it("handles empty catalog", () => {
      const prompt = buildSkillSelectionSystemPrompt([]);
      expect(prompt).toBeTruthy();
      expect(prompt).toContain("Available techniques");
    });
  });

  describe("buildSkillSelectionUserPrompt", () => {
    it("includes transcript excerpt", () => {
      const transcript = "[0.0s-5.0s] Hello world. [5.0s-10.0s] This is a test.";
      const prompt = buildSkillSelectionUserPrompt(transcript);
      expect(prompt).toContain(transcript);
    });

    it("starts with task instruction", () => {
      const prompt = buildSkillSelectionUserPrompt("Some text");
      expect(prompt).toContain("Analyze this transcript excerpt");
      expect(prompt).toContain("select the most relevant manipulation techniques");
    });
  });
});
