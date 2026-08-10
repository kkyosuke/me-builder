import { and, count, gte, lt, sql } from "drizzle-orm";
import type { D1Client } from "../client";
import { geminiUsageRecords } from "../schema";

export type GeminiUsageRecordInput = {
  responseId: string;
  operation: "diary_chat" | "diary_brain";
  model: string;
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  cachedContentTokenCount: number;
  toolUsePromptTokenCount: number;
  totalTokenCount: number;
  generatedAt: Date;
};

export type GeminiUsageSummary = {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  cachedContentTokens: number;
  toolUsePromptTokens: number;
  totalTokens: number;
};

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

/** responseIdを冪等キーとしてGoogle由来のtoken利用量を保存する。 */
export async function storeGeminiUsage(db: D1Client, input: GeminiUsageRecordInput): Promise<void> {
  if (!input.responseId.trim()) throw new Error("Gemini responseId is required");
  if (!input.model.trim()) throw new Error("Gemini model is required");
  for (const [name, value] of Object.entries({
    promptTokenCount: input.promptTokenCount,
    candidatesTokenCount: input.candidatesTokenCount,
    thoughtsTokenCount: input.thoughtsTokenCount,
    cachedContentTokenCount: input.cachedContentTokenCount,
    toolUsePromptTokenCount: input.toolUsePromptTokenCount,
    totalTokenCount: input.totalTokenCount,
  })) {
    requireNonNegativeInteger(name, value);
  }

  await db.insert(geminiUsageRecords).values(input).onConflictDoNothing();
}

/** 指定期間にGoogleから返されたtoken利用量を集計する。endは含まない。 */
export async function summarizeGeminiUsage(
  db: D1Client,
  start: Date,
  end: Date,
): Promise<GeminiUsageSummary> {
  const result = await db
    .select({
      requestCount: count(),
      inputTokens: sql<number>`coalesce(sum(${geminiUsageRecords.promptTokenCount}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${geminiUsageRecords.candidatesTokenCount}), 0)`,
      thoughtsTokens: sql<number>`coalesce(sum(${geminiUsageRecords.thoughtsTokenCount}), 0)`,
      cachedContentTokens: sql<number>`coalesce(sum(${geminiUsageRecords.cachedContentTokenCount}), 0)`,
      toolUsePromptTokens: sql<number>`coalesce(sum(${geminiUsageRecords.toolUsePromptTokenCount}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${geminiUsageRecords.totalTokenCount}), 0)`,
    })
    .from(geminiUsageRecords)
    .where(and(gte(geminiUsageRecords.generatedAt, start), lt(geminiUsageRecords.generatedAt, end)))
    .get();

  return {
    requestCount: Number(result?.requestCount ?? 0),
    inputTokens: Number(result?.inputTokens ?? 0),
    outputTokens: Number(result?.outputTokens ?? 0),
    thoughtsTokens: Number(result?.thoughtsTokens ?? 0),
    cachedContentTokens: Number(result?.cachedContentTokens ?? 0),
    toolUsePromptTokens: Number(result?.toolUsePromptTokens ?? 0),
    totalTokens: Number(result?.totalTokens ?? 0),
  };
}
