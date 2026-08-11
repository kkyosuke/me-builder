import type {
  ProfileSummaryEvidence,
  ProfileSummaryGenerationContext,
  ProfileSummaryInsight,
} from "@me-builder/lib";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { WorkerConfig } from "../config";
import { createGeminiClient, generateStructuredText } from "../infrastructure/gemini-client";
import { PROFILE_SUMMARY_SYSTEM_PROMPT } from "../prompt/profile-summary";

const InsightSchema = v.strictObject({
  key: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
  label: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
  description: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  evidence_ids: v.pipe(
    v.array(v.pipe(v.string(), v.minLength(1))),
    v.minLength(1),
    v.maxLength(20),
  ),
});

const ResponseSchema = v.strictObject({
  headline: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  insights: v.pipe(v.array(InsightSchema), v.minLength(1), v.maxLength(3)),
});

export type GeneratedProfileSummary = Readonly<{
  headline: string;
  insights: readonly ProfileSummaryInsight[];
}>;

export function validateGeneratedProfileSummary(
  raw: string,
  evidence: readonly ProfileSummaryEvidence[],
): GeneratedProfileSummary | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = v.safeParse(ResponseSchema, json);
  if (!parsed.success) return undefined;
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const keys = new Set<string>();
  const insights: ProfileSummaryInsight[] = [];
  for (const insight of parsed.output.insights) {
    if (keys.has(insight.key)) return undefined;
    keys.add(insight.key);
    const ids = [...new Set(insight.evidence_ids)];
    if (ids.length !== insight.evidence_ids.length || ids.some((id) => !evidenceById.has(id))) {
      return undefined;
    }
    const sources = [...new Set(ids.map((id) => evidenceById.get(id)?.source))].filter(
      (source): source is "diagnosis" | "diary" => source !== undefined,
    );
    insights.push({
      key: insight.key,
      label: insight.label,
      description: insight.description,
      evidenceCount: ids.length,
      sources,
    });
  }
  return { headline: parsed.output.headline, insights };
}

export async function generateProfileSummary(
  context: ProfileSummaryGenerationContext,
  workerConfig: WorkerConfig,
): Promise<GeneratedProfileSummary | undefined> {
  if (!workerConfig.googleVertexAiApiKey || context.evidence.length === 0) return undefined;
  const client = createGeminiClient({
    googleVertexAiApiKey: workerConfig.googleVertexAiApiKey,
  });
  const contents = JSON.stringify({
    context_package: {
      evidence: context.evidence.map(({ id, source, text, recordedAt }) => ({
        id,
        source,
        text,
        recorded_at: recordedAt.toISOString(),
      })),
    },
  });
  const responseJsonSchema = toJsonSchema(ResponseSchema) as Record<string, unknown>;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await generateStructuredText(client, {
      model: workerConfig.geminiModel,
      contents,
      systemInstruction: PROFILE_SUMMARY_SYSTEM_PROMPT,
      responseJsonSchema,
      maxOutputTokens: 2_500,
    });
    const generated = raw ? validateGeneratedProfileSummary(raw, context.evidence) : undefined;
    if (generated) return generated;
  }
  return undefined;
}
