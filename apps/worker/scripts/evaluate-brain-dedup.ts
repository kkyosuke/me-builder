import { logger } from "@me-builder/shared";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import { getWorkerConfig } from "../src/config";
import { brainDedupEvaluationFixtures } from "../src/evaluation/brain-dedup-fixtures";
import { createGeminiClient, generateStructuredText } from "../src/infrastructure/gemini-client";
import {
  BRAIN_DEDUP_SYSTEM_PROMPT,
  buildBrainDedupDecisionContents,
} from "../src/prompt/brain-dedup";

const MatchSchema = v.strictObject({
  candidate_index: v.literal(0),
  existing_brain_item_id: v.literal("existing-fixture"),
  judgment: v.literal("same_proposition"),
});
const ResponseSchema = v.strictObject({ matches: v.pipe(v.array(MatchSchema), v.maxLength(1)) });

const config = getWorkerConfig();
if (!config.googleVertexAiApiKey) {
  throw new Error("GOOGLE_VERTEX_AI_API_KEY is required for the Brain dedup evaluation");
}

const client = createGeminiClient({ googleVertexAiApiKey: config.googleVertexAiApiKey });
const failures: string[] = [];

for (const fixture of brainDedupEvaluationFixtures) {
  const raw = await generateStructuredText(client, {
    model: config.geminiModel,
    contents: buildBrainDedupDecisionContents({
      newCandidates: [
        {
          candidate_index: 0,
          category: fixture.category,
          statement: fixture.candidate,
          is_inference: false,
        },
      ],
      candidateTargets: [
        {
          candidate_index: 0,
          category: fixture.category,
          statement: fixture.candidate,
          is_inference: false,
        },
      ],
      existingItems: [
        {
          brain_item_id: "existing-fixture",
          category: fixture.category,
          statement: fixture.existing,
          is_inference: false,
        },
      ],
    }),
    systemInstruction: BRAIN_DEDUP_SYSTEM_PROMPT,
    responseJsonSchema: toJsonSchema(ResponseSchema) as Record<string, unknown>,
    maxOutputTokens: 200,
  });
  let actual = false;
  try {
    const parsed = raw ? v.safeParse(ResponseSchema, JSON.parse(raw) as unknown) : undefined;
    if (!parsed?.success) {
      failures.push(`${fixture.id}:invalid-response`);
      continue;
    }
    actual = parsed.output.matches.length === 1;
  } catch {
    failures.push(`${fixture.id}:invalid-json`);
    continue;
  }
  if (actual !== fixture.sameProposition) failures.push(`${fixture.id}:wrong-judgment`);
}

logger.info(
  {
    model: config.geminiModel,
    fixtureCount: brainDedupEvaluationFixtures.length,
    failureCount: failures.length,
    failureIds: failures,
  },
  "Brain dedup evaluation completed",
);

if (failures.length > 0) process.exitCode = 1;
