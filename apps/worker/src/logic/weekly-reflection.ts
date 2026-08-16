import type {
  WeeklyReflectionEvidence,
  WeeklyReflectionGenerationContext,
  WeeklyReflectionItem,
} from "@me-builder/lib";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { WorkerConfig } from "../config";
import {
  type GeminiUsageRecorder,
  createGeminiClient,
  generateStructuredResponse,
} from "../infrastructure/gemini-client";
import { WEEKLY_REFLECTION_SYSTEM_PROMPT } from "../prompt/weekly-reflection";

const ItemSchema = v.strictObject({
  kind: v.picklist(["pattern", "value", "next-step", "question"]),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
  description: v.pipe(v.string(), v.minLength(1), v.maxLength(400)),
  evidence_ids: v.pipe(
    v.array(v.pipe(v.string(), v.minLength(1))),
    v.minLength(1),
    v.maxLength(20),
  ),
});
const ResponseSchema = v.strictObject({
  headline: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  items: v.pipe(v.array(ItemSchema), v.minLength(1), v.maxLength(3)),
});

export type WeeklyReflectionFailureReason =
  | "ai_credentials_missing"
  | "evidence_empty"
  | "response_empty"
  | "response_truncated"
  | "response_not_json"
  | "response_schema_mismatch"
  | "item_order_invalid"
  | "evidence_invalid";

export type WeeklyReflectionGenerationOutcome =
  | Readonly<{ type: "generated"; headline: string; items: readonly WeeklyReflectionItem[] }>
  | Readonly<{ type: "failed"; reason: WeeklyReflectionFailureReason }>;

function validate(
  raw: string,
  evidence: readonly WeeklyReflectionEvidence[],
): WeeklyReflectionGenerationOutcome {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { type: "failed", reason: "response_not_json" };
  }
  const parsed = v.safeParse(ResponseSchema, json);
  if (!parsed.success) return { type: "failed", reason: "response_schema_mismatch" };
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const kinds = parsed.output.items.map(({ kind }) => kind);
  const sparse = evidence.filter(({ source }) => source === "diary").length < 2;
  if (
    (sparse && (kinds.length !== 1 || kinds[0] !== "question")) ||
    (!sparse && kinds.some((kind, index) => kind !== ["pattern", "value", "next-step"][index]))
  ) {
    return { type: "failed", reason: "item_order_invalid" };
  }
  const items: WeeklyReflectionItem[] = [];
  for (const item of parsed.output.items) {
    const ids = [...new Set(item.evidence_ids)];
    if (ids.length !== item.evidence_ids.length || ids.some((id) => !evidenceById.has(id))) {
      return { type: "failed", reason: "evidence_invalid" };
    }
    items.push({
      kind: item.kind,
      title: item.title,
      description: item.description,
      evidenceCount: ids.length,
      sources: [
        ...new Set(
          ids.flatMap((id) => {
            const source = evidenceById.get(id)?.source;
            return source ? [source] : [];
          }),
        ),
      ],
    });
  }
  return { type: "generated", headline: parsed.output.headline, items };
}

export async function generateWeeklyReflection(
  context: WeeklyReflectionGenerationContext,
  workerConfig: WorkerConfig,
  onUsage?: GeminiUsageRecorder,
): Promise<WeeklyReflectionGenerationOutcome> {
  if (!workerConfig.googleVertexAiApiKey) {
    return { type: "failed", reason: "ai_credentials_missing" };
  }
  if (context.evidence.length === 0) return { type: "failed", reason: "evidence_empty" };
  const client = createGeminiClient({ googleVertexAiApiKey: workerConfig.googleVertexAiApiKey });
  const contents = JSON.stringify({
    context_package: {
      week_start: context.weekStart,
      evidence: context.evidence.map(({ id, source, text, recordedAt }) => ({
        id,
        source,
        text,
        recorded_at: recordedAt.toISOString(),
      })),
    },
  });
  let reason: WeeklyReflectionFailureReason = "response_empty";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await generateStructuredResponse(client, {
      model: workerConfig.geminiModel,
      contents,
      systemInstruction: WEEKLY_REFLECTION_SYSTEM_PROMPT,
      responseJsonSchema: toJsonSchema(ResponseSchema) as Record<string, unknown>,
      maxOutputTokens: 4_000,
      ...(onUsage ? { onUsage } : {}),
    });
    if (!response.text) {
      reason = response.finishReason === "MAX_TOKENS" ? "response_truncated" : "response_empty";
      continue;
    }
    const validated = validate(response.text, context.evidence);
    if (validated.type === "generated") return validated;
    reason = response.finishReason === "MAX_TOKENS" ? "response_truncated" : validated.reason;
  }
  return { type: "failed", reason };
}
