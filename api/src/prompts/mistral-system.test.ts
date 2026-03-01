import { describe, it, expect } from "vitest";
import {
  buildAnalysisSystemPrompt,
  type ExtractedContext,
} from "./mistral-system.js";

describe("mistral-system (detection prompt)", () => {
  const sampleSkillsContext = `### Montée en généralité (montee-en-generalite)
Generalizing from specific cases.
**How to recognize:**
Look for specific-to-general statements.
**Examples:**
- "This one incident proves that all members are dangerous."`;

  describe("buildAnalysisSystemPrompt", () => {
    it("includes skills section when skillsContext is non-empty", () => {
      const prompt = buildAnalysisSystemPrompt(sampleSkillsContext);
      expect(prompt).toContain("Manipulation techniques to detect");
      expect(prompt).toContain("montee-en-generalite");
      expect(prompt).toContain("How to recognize");
    });

    it("omits skills section when skillsContext is empty", () => {
      const prompt = buildAnalysisSystemPrompt("");
      expect(prompt).not.toContain("Manipulation techniques to detect");
    });

    it("always includes output format and rules", () => {
      const prompt = buildAnalysisSystemPrompt(sampleSkillsContext);
      expect(prompt).toContain("alerts");
      expect(prompt).toContain("fact_checks");
      expect(prompt).toContain("technique");
      expect(prompt).toContain("severity");
      expect(prompt).toContain("Timestamps");
    });

    it("injects extracted context when provided", () => {
      const context: ExtractedContext = {
        summary: "A debate on immigration policy.",
        main_topics: ["immigration", "border control"],
        notable_claims: ["50,000 crossed in 2023"],
      };
      const prompt = buildAnalysisSystemPrompt(sampleSkillsContext, context);
      expect(prompt).toContain("Context (for focus)");
      expect(prompt).toContain("A debate on immigration policy.");
      expect(prompt).toContain("immigration");
      expect(prompt).toContain("50,000 crossed in 2023");
    });

    it("omits context section when extractedContext is empty/minimal", () => {
      const prompt = buildAnalysisSystemPrompt(sampleSkillsContext, {});
      expect(prompt).not.toContain("Context (for focus)");
    });

    it("omits context when extractedContext has no summary, topics, or claims", () => {
      const context: ExtractedContext = {
        key_entities: ["Someone"],
        argument_structure: "Narrative",
      };
      const prompt = buildAnalysisSystemPrompt(sampleSkillsContext, context);
      // Context section is shown if summary, main_topics, or notable_claims exist
      expect(prompt).not.toContain("Context (for focus)");
    });
  });
});
