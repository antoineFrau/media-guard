import { describe, it, expect } from "vitest";
import {
  buildSummarizationSystemPrompt,
  buildSummarizationUserPrompt,
} from "./summarization.js";

describe("summarization prompts", () => {
  describe("buildSummarizationSystemPrompt", () => {
    it("requires summary, main_topics, key_entities, argument_structure, notable_claims", () => {
      const prompt = buildSummarizationSystemPrompt();
      expect(prompt).toContain("summary");
      expect(prompt).toContain("main_topics");
      expect(prompt).toContain("key_entities");
      expect(prompt).toContain("argument_structure");
      expect(prompt).toContain("notable_claims");
    });

    it("returns valid JSON schema in instructions", () => {
      const prompt = buildSummarizationSystemPrompt();
      expect(prompt).toContain('"summary":');
      expect(prompt).toContain('"main_topics":');
    });
  });

  describe("buildSummarizationUserPrompt", () => {
    it("includes transcript text", () => {
      const transcript = "[0.0s-10.0s] Political debate about migration.";
      const prompt = buildSummarizationUserPrompt(transcript);
      expect(prompt).toContain(transcript);
    });

    it("starts with task instruction", () => {
      const prompt = buildSummarizationUserPrompt("Some text");
      expect(prompt).toContain("Summarize this video transcript");
      expect(prompt).toContain("extract context for manipulation detection");
    });
  });
});
