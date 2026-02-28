import { z } from "zod";

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

export const ExampleSchema = z.object({
  quote: z.string(),
  videoId: z.string(),
  context: z.string().optional(),
});

export const ExtractedTechniqueSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  examples: z.array(ExampleSchema),
  category: z.enum(["rhetoric", "bias", "factual", "framing", "other"]),
});

export const ExtractionResultSchema = z.object({
  techniques: z.array(ExtractedTechniqueSchema),
});

export type ExtractedTechnique = z.infer<typeof ExtractedTechniqueSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
export type TechniqueCategory = ExtractedTechnique["category"];

const TechniqueCategorySchema = z.enum(["rhetoric", "bias", "factual", "framing", "other"]);

export const PaperSourceSchema = z.object({
  paperId: z.string(),
  title: z.string(),
  url: z.string(),
  year: z.number().optional(),
  abstract: z.string().optional(),
});

export const TechniqueWithSourcesSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  category: TechniqueCategorySchema,
  examples: z.array(ExampleSchema),
  sources: z.array(PaperSourceSchema),
  skillPath: z.string(),
});

export type TechniqueWithSources = z.infer<typeof TechniqueWithSourcesSchema>;
export type PaperSource = z.infer<typeof PaperSourceSchema>;

export const ProblemsDbSchema = z.object({
  generatedAt: z.string(),
  channel: z.object({
    handle: z.string(),
    name: z.string(),
  }),
  videosProcessed: z.array(z.string()),
  techniques: z.array(TechniqueWithSourcesSchema),
});

export type ProblemsDb = z.infer<typeof ProblemsDbSchema>;
