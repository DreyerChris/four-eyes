import { z } from "zod";
import { ChunkKindSchema, DiffSideSchema, SeveritySchema, VerdictSuggestionSchema } from "./domain";

export const ChunkPlanSchema = z.object({
  chunks: z
    .array(
      z.object({
        title: z.string().min(1),
        explanation: z.string(),
        kind: ChunkKindSchema,
        hunkIds: z.array(z.string()).readonly(),
      }).readonly(),
    )
    .readonly(),
}).readonly();
export type ChunkPlan = z.infer<typeof ChunkPlanSchema>;
export type PlannedChunk = ChunkPlan["chunks"][number];

export const ReviewResultSchema = z.object({
  verdict: z.object({
    summary: z.string(),
    suggestion: VerdictSuggestionSchema,
  }).readonly(),
  findings: z
    .array(
      z.object({
        severity: SeveritySchema,
        title: z.string().min(1),
        explanation: z.string(),
        hunkIds: z.array(z.string()).readonly(),
        suggestedFix: z.string().optional(),
        range: z
          .object({
            side: DiffSideSchema,
            startLine: z.number().int(),
            endLine: z.number().int(),
          })
          .readonly()
          .optional(),
      }).readonly(),
    )
    .readonly(),
}).readonly();
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export type ReviewResultFinding = ReviewResult["findings"][number];

export type JsonSchema = Readonly<Record<string, unknown>>;

const toOutputJsonSchema = (schema: z.ZodType): JsonSchema => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    target: "draft-7",
    override: ({ jsonSchema }) => {
      delete jsonSchema.readOnly;
    },
  });
  return rest;
};

export const CHUNK_PLAN_JSON_SCHEMA: JsonSchema = toOutputJsonSchema(ChunkPlanSchema);
export const REVIEW_RESULT_JSON_SCHEMA: JsonSchema = toOutputJsonSchema(ReviewResultSchema);
