import type {
  GeneratedCompatibilityShareStatement,
  ProfileSummaryEvidence,
  ProfileSummaryGenerationContext,
  ProfileSummaryInsight,
} from "@me-builder/lib";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { WorkerConfig } from "../config";
import {
  type GeminiUsageRecorder,
  createGeminiClient,
  generateStructuredResponse,
} from "../infrastructure/gemini-client";
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

/**
 * 共有専用文章のschemaは、極端な応答だけを弾く緩い形にします。
 * 件数と1件ごとの形式は保存前の決定的な検査が持ち、外れた文章だけを落とします。
 * ここを厳しくすると、共有文章1件の不備で本人向けの版まで保存できなくなります。
 */
const CompatibilityShareStatementSchema = v.strictObject({
  key: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
  label: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  statement: v.pipe(v.string(), v.minLength(1), v.maxLength(400)),
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
    statements: v.pipe(v.array(CompatibilityShareStatementSchema), v.maxLength(10)),
  }),
});

/** 共有できる文章の上限。超えた分は保存前の検査で落とす。 */
const COMPATIBILITY_SHARE_STATEMENT_LIMIT = 3;
const COMPATIBILITY_SHARE_LABEL_MAX_LENGTH = 40;

/** 半角の`!?`も、全角と同じく文章を分ける記号として扱う。 */
const SAFE_COMPATIBILITY_SHARE_STATEMENT =
  /^私は、[^\n。！？!?]{2,220}(?:を大切にしています|しやすいです|心地よく感じます|を好みます|したいです)[。]?$/u;
const FORBIDDEN_COMPATIBILITY_SHARE_DETAIL =
  /[0-9０-９]|[「」『』“”"]|(?:今日|昨日|一昨日|明日|先週|今週|来週|先月|今月|来月|去年|今年|来年)|(?:[\p{Script=Han}\p{Script=Katakana}ー]{1,}(?:さん|氏|ちゃん|くん|先生))|(?:[\p{Script=Han}\p{Script=Katakana}ー]{2,}(?:都|道|府|県|市|区|町|村|駅|空港|公園|店舗|ホテル|学校|大学|病院|会社))|(?:健康|病気|病名|診断|治療|療養|服薬|薬|通院|入院|退院|症状|障害|うつ|鬱|パニック|不眠|自傷|自殺)|(?:日記|LINE|会話(?:本文|の引用)|相手|あなた|すべき|してほしい|して欲しい|得意|苦手|性格|能力|優秀)/u;
const EVIDENCE_EXCERPT_LENGTH = 20;
const UNSAFE_PROFILE_SUMMARY_ASSERTION =
  /(?:あなたは.{0,20}(?:うつ病|鬱病|発達障害|精神疾患|病気)(?:です|でしょう|に違いありません))|(?:(?:必ず|絶対に).{0,40}(?:失敗します|成功します|病気になります|自傷します))|(?:医師|専門家).{0,12}(?:不要です|必要ありません)/u;

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

/**
 * 外部共有用文章を1件だけ落とした理由。
 * 本文を運用ログへ出さずに、どの決定的ルールで落ちたかを追えるようにする。
 */
export type CompatibilityShareRejectionRule =
  | "count_exceeded"
  | "key_duplicated"
  | "evidence_invalid"
  | "label_shape"
  | "statement_shape"
  | "forbidden_detail"
  | "evidence_excerpt";

/** 版そのものを保存できないと判断した理由。 */
type ProfileSummaryValidationFailureReason =
  | "response_not_json"
  | "response_schema_mismatch"
  | "insight_key_duplicated"
  | "insight_evidence_invalid"
  | "insight_unsafe_assertion";

/** 生成を完了できなかった理由。運用ログのエラーコードへ1対1で対応させる。 */
export type ProfileSummaryGenerationFailureReason =
  | ProfileSummaryValidationFailureReason
  | "ai_credentials_missing"
  | "evidence_empty"
  | "response_empty"
  | "response_truncated";

/** 外部共有用文章を、生成モデルとは独立した最低限の決定的ルールでfail closedにする。 */
function rejectionRuleOfCompatibilityShareStatement(
  label: string,
  statement: string,
  referencedEvidence: readonly ProfileSummaryEvidence[],
): CompatibilityShareRejectionRule | undefined {
  if (/[\n。！？]/u.test(label) || label.length > COMPATIBILITY_SHARE_LABEL_MAX_LENGTH) {
    return "label_shape";
  }
  if (!SAFE_COMPATIBILITY_SHARE_STATEMENT.test(statement)) return "statement_shape";
  if (
    FORBIDDEN_COMPATIBILITY_SHARE_DETAIL.test(label) ||
    FORBIDDEN_COMPATIBILITY_SHARE_DETAIL.test(statement)
  ) {
    return "forbidden_detail";
  }
  if (
    containsEvidenceExcerpt(label, referencedEvidence) ||
    containsEvidenceExcerpt(statement, referencedEvidence)
  ) {
    return "evidence_excerpt";
  }
  return undefined;
}

type GeneratedProfileSummary = Readonly<{
  headline: string;
  insights: readonly ProfileSummaryInsight[];
  compatibilityShareStatements: readonly GeneratedCompatibilityShareStatement[];
}>;

export type ProfileSummaryValidationResult =
  | Readonly<{
      type: "valid";
      summary: GeneratedProfileSummary;
      /** 共有せずに落とした文章の理由。1件も残らない場合もsummary自体は保存する。 */
      rejectedShareRules: readonly CompatibilityShareRejectionRule[];
    }>
  | Readonly<{ type: "invalid"; reason: ProfileSummaryValidationFailureReason }>;

/**
 * 共有専用文章は1件ずつ検査し、外れた文章だけを落とします。
 * 本人向けのheadlineとinsightsが有効なら版を保存し、共有側の欠落は
 * 「わたしのまとめ」の再生成理由として次の生成へ回します。
 */
export function validateGeneratedProfileSummary(
  raw: string,
  evidence: readonly ProfileSummaryEvidence[],
): ProfileSummaryValidationResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { type: "invalid", reason: "response_not_json" };
  }
  const parsed = v.safeParse(ResponseSchema, json);
  if (!parsed.success) return { type: "invalid", reason: "response_schema_mismatch" };
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const keys = new Set<string>();
  const insights: ProfileSummaryInsight[] = [];
  for (const insight of parsed.output.insights) {
    if (keys.has(insight.key)) return { type: "invalid", reason: "insight_key_duplicated" };
    if (
      UNSAFE_PROFILE_SUMMARY_ASSERTION.test(insight.label) ||
      UNSAFE_PROFILE_SUMMARY_ASSERTION.test(insight.description)
    ) {
      return { type: "invalid", reason: "insight_unsafe_assertion" };
    }
    keys.add(insight.key);
    const ids = [...new Set(insight.evidence_ids)];
    if (ids.length !== insight.evidence_ids.length || ids.some((id) => !evidenceById.has(id))) {
      return { type: "invalid", reason: "insight_evidence_invalid" };
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
  const rejectedShareRules: CompatibilityShareRejectionRule[] = [];
  for (const statement of parsed.output.compatibility_share.statements) {
    if (compatibilityShareStatements.length >= COMPATIBILITY_SHARE_STATEMENT_LIMIT) {
      rejectedShareRules.push("count_exceeded");
      continue;
    }
    if (shareKeys.has(statement.key)) {
      rejectedShareRules.push("key_duplicated");
      continue;
    }
    const evidenceIds = [...new Set(statement.evidence_ids)];
    if (
      evidenceIds.length !== statement.evidence_ids.length ||
      evidenceIds.some((id) => !evidenceById.has(id))
    ) {
      rejectedShareRules.push("evidence_invalid");
      continue;
    }
    const referencedEvidence = evidenceIds.flatMap((id) => {
      const item = evidenceById.get(id);
      return item ? [item] : [];
    });
    const rejectionRule = rejectionRuleOfCompatibilityShareStatement(
      statement.label,
      statement.statement,
      referencedEvidence,
    );
    if (rejectionRule) {
      rejectedShareRules.push(rejectionRule);
      continue;
    }
    // 落とした文章はkeyを占有しない。同じkeyで送られた後続の妥当な文章を残せるようにする。
    shareKeys.add(statement.key);
    compatibilityShareStatements.push({
      key: statement.key,
      label: statement.label,
      statement: statement.statement,
      evidenceIds,
    });
  }
  return {
    type: "valid",
    summary: { headline: parsed.output.headline, insights, compatibilityShareStatements },
    rejectedShareRules,
  };
}

export type ProfileSummaryGenerationOutcome =
  | Readonly<{
      type: "generated";
      summary: GeneratedProfileSummary;
      rejectedShareRules: readonly CompatibilityShareRejectionRule[];
    }>
  | Readonly<{ type: "failed"; reason: ProfileSummaryGenerationFailureReason }>;

/** 同じcontextで作り直す回数。ここでの失敗はQueueの再試行より先に使い切る。 */
const GENERATION_ATTEMPT_LIMIT = 2;

/**
 * 応答の上限token数。
 * headline、insight最大3件、共有専用文章最大3件に加えて、モデルが使う
 * thinking tokenも同じ上限を消費する。上限で切れた応答は途中までのJSONになり
 * 版を保存できないため、想定する応答長より余裕を持たせる。
 */
const GENERATION_MAX_OUTPUT_TOKENS = 8_000;

export async function generateProfileSummary(
  context: ProfileSummaryGenerationContext,
  workerConfig: WorkerConfig,
  onUsage?: GeminiUsageRecorder,
): Promise<ProfileSummaryGenerationOutcome> {
  if (!workerConfig.googleVertexAiApiKey) {
    return { type: "failed", reason: "ai_credentials_missing" };
  }
  if (context.evidence.length === 0) return { type: "failed", reason: "evidence_empty" };
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
      self_views: context.selfViews ?? [],
    },
  });
  const responseJsonSchema = toJsonSchema(ResponseSchema) as Record<string, unknown>;
  let reason: ProfileSummaryGenerationFailureReason = "response_empty";
  for (let attempt = 0; attempt < GENERATION_ATTEMPT_LIMIT; attempt += 1) {
    const response = await generateStructuredResponse(client, {
      model: workerConfig.geminiModel,
      contents,
      systemInstruction: PROFILE_SUMMARY_SYSTEM_PROMPT,
      responseJsonSchema,
      maxOutputTokens: GENERATION_MAX_OUTPUT_TOKENS,
      ...(onUsage ? { onUsage } : {}),
    });
    const truncated = response.finishReason === "MAX_TOKENS";
    if (!response.text) {
      reason = truncated ? "response_truncated" : "response_empty";
      continue;
    }
    const validated = validateGeneratedProfileSummary(response.text, context.evidence);
    if (validated.type === "valid") {
      return {
        type: "generated",
        summary: validated.summary,
        rejectedShareRules: validated.rejectedShareRules,
      };
    }
    // 上限で切れた応答は不正なJSONやschema不適合として現れるため、切断を原因として残す。
    reason = truncated ? "response_truncated" : validated.reason;
  }
  return { type: "failed", reason };
}
