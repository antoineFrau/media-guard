import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TranscriptSegment } from "./types.js";

vi.mock("./skills.js", () => {
  const mockSkills = [
    { slug: "montee-en-generalite", name: "Montée en généralité", description: "Desc", howToRecognize: "How", examples: "Ex" },
  ];
  return {
    loadSkills: vi.fn().mockResolvedValue(mockSkills),
    buildSkillCatalog: vi.fn((skills: typeof mockSkills) =>
      skills.map((s) => ({ slug: s.slug, name: s.name, description: s.description }))
    ),
    buildSkillsContext: vi.fn((skills: typeof mockSkills) =>
      skills.map((s) => `### ${s.name} (${s.slug})\n${s.description}`).join("\n")
    ),
    getSkillsContextForSlugs: vi.fn().mockResolvedValue(
      "### Montée en généralité (montee-en-generalite)\nDesc"
    ),
  };
});

const MOCK_SKILLS = [
  { slug: "montee-en-generalite", name: "Montée en généralité", description: "Desc", howToRecognize: "How", examples: "Ex" },
];

const sampleTranscript: TranscriptSegment[] = [
  { text: "Hello world.", start: 0, end: 2.5 },
  { text: "This is a political debate.", start: 2.5, end: 5.0 },
];

function createMockFetch(responses: string[]) {
  let callIndex = 0;
  return vi.fn(async (_url: string, opts?: { body?: string }) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    const messages = body.messages ?? [];
    const response = responses[callIndex] ?? JSON.stringify({ alerts: [], fact_checks: [] });
    callIndex += 1;

    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: response } }],
      }),
    };
  });
}

describe("analyzeTranscript workflow", () => {
  const originalEnv = process.env.ENABLE_MULTI_PHASE_ANALYSIS;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let analyzeTranscript: typeof import("./mistral.js").analyzeTranscript;

  beforeEach(async () => {
    const { loadSkills, getSkillsContextForSlugs } = await import("./skills.js");
    vi.mocked(loadSkills).mockResolvedValue(MOCK_SKILLS);
    vi.mocked(getSkillsContextForSlugs).mockResolvedValue(
      "### Montée en généralité (montee-en-generalite)\nDesc"
    );
    vi.resetModules();
    const mistral = await import("./mistral.js");
    analyzeTranscript = mistral.analyzeTranscript;
  });

  afterEach(() => {
    process.env.ENABLE_MULTI_PHASE_ANALYSIS = originalEnv;
    vi.restoreAllMocks();
  });

  describe("multi-phase mode (ENABLE_MULTI_PHASE_ANALYSIS !== 'false')", () => {
    beforeEach(() => {
      process.env.ENABLE_MULTI_PHASE_ANALYSIS = "true";
    });

    it("runs all three phases and returns alerts and fact_checks", async () => {
      const phase1Response = JSON.stringify({
        selected_skills: ["montee-en-generalite"],
        reasoning: "Relevant for political content.",
      });
      const phase2Response = JSON.stringify({
        summary: "A debate.",
        main_topics: ["politics"],
        key_entities: [],
        argument_structure: "Narrative",
        notable_claims: [],
      });
      const phase3Response = JSON.stringify({
        alerts: [
          { technique: "montee-en-generalite", quote: "Hello world.", start: 0, end: 2.5, severity: "low" },
        ],
        fact_checks: [],
      });

      mockFetch = createMockFetch([phase1Response, phase2Response, phase3Response]);
      vi.stubGlobal("fetch", mockFetch);

      const result = await analyzeTranscript(sampleTranscript, "test-key", null);

      expect(result).not.toBeNull();
      expect(result!.alerts).toHaveLength(1);
      expect(result!.alerts![0].technique).toBe("montee-en-generalite");
      expect(result!.fact_checks).toEqual([]);

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("fallback: Phase 1 invalid response uses all skills for Phase 3", async () => {
      const phase1Invalid = JSON.stringify({ wrong: "shape" });
      const phase2Response = JSON.stringify({
        summary: "X",
        main_topics: [],
        key_entities: [],
        argument_structure: "",
        notable_claims: [],
      });
      const phase3Response = JSON.stringify({ alerts: [], fact_checks: [] });

      mockFetch = createMockFetch([phase1Invalid, phase2Response, phase3Response]);
      vi.stubGlobal("fetch", mockFetch);

      const result = await analyzeTranscript(sampleTranscript, "test-key", null);

      expect(result).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(3);
      const { getSkillsContextForSlugs } = await import("./skills.js");
      expect(getSkillsContextForSlugs).toHaveBeenCalledWith(
        expect.arrayContaining(["montee-en-generalite"])
      );
    });

    it("fallback: Phase 2 failure still runs Phase 3 without context", async () => {
      let callCount = 0;
      mockFetch = vi.fn(async () => {
        callCount++;
        if (callCount === 2) {
          return { ok: false, text: async () => "error" };
        }
        const resp =
          callCount === 1
            ? JSON.stringify({ selected_skills: ["montee-en-generalite"], reasoning: "ok" })
            : JSON.stringify({ alerts: [], fact_checks: [] });
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: resp } }] }),
        };
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await analyzeTranscript(sampleTranscript, "test-key", null);

      expect(result).not.toBeNull();
      expect(result!.alerts).toEqual([]);
      expect(result!.fact_checks).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("legacy mode (ENABLE_MULTI_PHASE_ANALYSIS=false)", () => {
    beforeEach(async () => {
      process.env.ENABLE_MULTI_PHASE_ANALYSIS = "false";
      vi.resetModules();
      const mistral = await import("./mistral.js");
      analyzeTranscript = mistral.analyzeTranscript;
    });

    it("makes single Mistral call and returns analysis", async () => {
      const legacyResponse = JSON.stringify({
        alerts: [{ technique: "appel-a-la-peur", quote: "Fear.", start: 0, end: 1, severity: "medium" }],
        fact_checks: [{ claim: "A claim.", verdict: "unsourced", start: 0, end: 1 }],
      });

      mockFetch = createMockFetch([legacyResponse]);
      vi.stubGlobal("fetch", mockFetch);

      const result = await analyzeTranscript(sampleTranscript, "test-key", null);

      expect(result).not.toBeNull();
      expect(result!.alerts).toHaveLength(1);
      expect(result!.fact_checks).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
