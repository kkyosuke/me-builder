import type {
  GeneratedCompatibilityShareStatement,
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
  compatibility_share: v.strictObject({
    statements: v.pipe(
      v.array(
        v.strictObject({
          key: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
          label: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
          statement: v.pipe(v.string(), v.minLength(1), v.maxLength(240)),
          evidence_ids: v.pipe(
            v.array(v.pipe(v.string(), v.minLength(1))),
            v.minLength(1),
            v.maxLength(20),
          ),
        }),
      ),
      v.minLength(1),
      v.maxLength(3),
    ),
  }),
});

const SAFE_COMPATIBILITY_SHARE_STATEMENT =
  /^私は、[^\n。！？]{2,220}(?:を大切にしています|しやすいです|心地よく感じます|を好みます|したいです)[。]?$/u;
const FORBIDDEN_COMPATIBILITY_SHARE_DETAIL =
  /[0-9０-９]|[「」『』“”"]|(?:今日|昨日|一昨日|明日|先週|今週|来週|先月|今月|来月|去年|今年|来年)|(?:[\p{Script=Han}\p{Script=Katakana}ー]{1,}(?:さん|氏|ちゃん|くん|先生))|(?:[\p{Script=Han}\p{Script=Katakana}ー]{2,}(?:都|道|府|県|市|区|町|村|駅|空港|公園|店舗|ホテル|学校|大学|病院|会社))|(?:健康|病気|病名|診断|治療|療養|服薬|薬|通院|入院|退院|症状|障害|うつ|鬱|パニック|不眠|自傷|自殺)|(?:日記|LINE|会話(?:本文|の引用)|相手|あなた|すべき|してほしい|して欲しい|得意|苦手|性格|能力|優秀)/u;
const EVIDENCE_EXCERPT_LENGTH = 20;

function normalizeForExcerptComparison(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .toLowerCase();
}

function containsEvidenceExcerpt(
  value: string,
  referencedEvidence: readonly ProfileSummaryEvidence[],
): boolean {
  const normalizedValue = normalizeForExcerptComparison(value);
  if (normalizedValue.length < EVIDENCE_EXCERPT_LENGTH) return false;

  for (const evidence of referencedEvidence) {
    const normalizedEvidence = normalizeForExcerptComparison(evidence.text);
    for (let index = 0; index <= normalizedValue.length - EVIDENCE_EXCERPT_LENGTH; index += 1) {
      if (
        normalizedEvidence.includes(normalizedValue.slice(index, index + EVIDENCE_EXCERPT_LENGTH))
      ) {
        return true;
      }
    }
  }
  return false;
}

/** 外部共有用文章を、生成モデルとは独立した最低限の決定的ルールでfail closedにする。 */
function isSafeCompatibilityShareStatement(
  label: string,
  statement: string,
  referencedEvidence: readonly ProfileSummaryEvidence[],
): boolean {
  return (
    !/[\n。！？]/u.test(label) &&
    SAFE_COMPATIBILITY_SHARE_STATEMENT.test(statement) &&
    !FORBIDDEN_COMPATIBILITY_SHARE_DETAIL.test(label) &&
    !FORBIDDEN_COMPATIBILITY_SHARE_DETAIL.test(statement) &&
    !containsEvidenceExcerpt(label, referencedEvidence) &&
    !containsEvidenceExcerpt(statement, referencedEvidence)
  );
}

export type GeneratedProfileSummary = Readonly<{
  headline: string;
  insights: readonly ProfileSummaryInsight[];
  compatibilityShareStatements: readonly GeneratedCompatibilityShareStatement[];
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
  const shareKeys = new Set<string>();
  const compatibilityShareStatements: GeneratedCompatibilityShareStatement[] = [];
  for (const statement of parsed.output.compatibility_share.statements) {
    if (shareKeys.has(statement.key)) return undefined;
    shareKeys.add(statement.key);
    const evidenceIds = [...new Set(statement.evidence_ids)];
    if (
      evidenceIds.length !== statement.evidence_ids.length ||
      evidenceIds.some((id) => !evidenceById.has(id))
    ) {
      return undefined;
    }
    const referencedEvidence = evidenceIds.flatMap((id) => {
      const item = evidenceById.get(id);
      return item ? [item] : [];
    });
    if (
      !isSafeCompatibilityShareStatement(statement.label, statement.statement, referencedEvidence)
    ) {
      return undefined;
    }
    compatibilityShareStatements.push({
      key: statement.key,
      label: statement.label,
      statement: statement.statement,
      evidenceIds,
    });
  }
  return { headline: parsed.output.headline, insights, compatibilityShareStatements };
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
      maxOutputTokens: 3_500,
    });
    const generated = raw ? validateGeneratedProfileSummary(raw, context.evidence) : undefined;
    if (generated) return generated;
  }
  return undefined;
}
