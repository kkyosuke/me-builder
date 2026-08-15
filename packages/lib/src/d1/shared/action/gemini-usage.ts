import { and, count, gte, lt, sql } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { geminiUsageRecords } from "../schema";
import {
  GEMINI_PRICING_AS_OF,
  estimateGeminiCostUsd,
  splitByGeminiPricingPeriods,
} from "./gemini-pricing";

export type GeminiUsageRecordInput = {
  responseId: string;
  accountId: string;
  operation: "diary_chat" | "diary_brain" | "profile_summary" | "weekly_reflection";
  model: string;
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  cachedContentTokenCount: number;
  toolUsePromptTokenCount: number;
  totalTokenCount: number;
  generatedAt: Date;
};

export type GeminiAccountUsageSummary = {
  accountId: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
};

export type GeminiUsageSummary = {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  cachedContentTokens: number;
  toolUsePromptTokens: number;
  totalTokens: number;
  costEstimate:
    | {
        status: "available";
        currency: "USD";
        amount: number;
        pricingAsOf: string;
      }
    | {
        status: "unavailable";
        issues: Array<{
          reason: "unsupported-model" | "invalid-usage" | "overflow";
          models: string[];
        }>;
      };
  accounts: GeminiAccountUsageSummary[];
};

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

/** responseIdを冪等キーとしてGoogle由来のtoken利用量を保存する。 */
export async function storeGeminiUsage(
  db: SharedD1Client,
  input: GeminiUsageRecordInput,
): Promise<void> {
  if (!input.responseId.trim()) throw new Error("Gemini responseId is required");
  if (!input.accountId.trim()) throw new Error("Gemini accountId is required");
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
  db: SharedD1Client,
  start: Date,
  end: Date,
): Promise<GeminiUsageSummary> {
  const results = (
    await Promise.all(
      splitByGeminiPricingPeriods(start, end).map(async (period) => {
        const rows = await db
          .select({
            accountId: geminiUsageRecords.accountId,
            model: geminiUsageRecords.model,
            requestCount: count(),
            inputTokens: sql<number>`coalesce(sum(${geminiUsageRecords.promptTokenCount}), 0)`,
            outputTokens: sql<number>`coalesce(sum(${geminiUsageRecords.candidatesTokenCount}), 0)`,
            thoughtsTokens: sql<number>`coalesce(sum(${geminiUsageRecords.thoughtsTokenCount}), 0)`,
            cachedContentTokens: sql<number>`coalesce(sum(${geminiUsageRecords.cachedContentTokenCount}), 0)`,
            toolUsePromptTokens: sql<number>`coalesce(sum(${geminiUsageRecords.toolUsePromptTokenCount}), 0)`,
            totalTokens: sql<number>`coalesce(sum(${geminiUsageRecords.totalTokenCount}), 0)`,
          })
          .from(geminiUsageRecords)
          .where(
            and(
              gte(geminiUsageRecords.generatedAt, period.start),
              lt(geminiUsageRecords.generatedAt, period.end),
            ),
          )
          .groupBy(geminiUsageRecords.accountId, geminiUsageRecords.model)
          .all();
        return rows.map((row) => ({ ...row, pricingAt: period.start }));
      }),
    )
  ).flat();

  type AccountAccumulator = Omit<GeminiAccountUsageSummary, "estimatedCostUsd"> & {
    costUsd: number;
    costUnavailable: boolean;
  };
  type CostIssueReason = "unsupported-model" | "invalid-usage" | "overflow";
  const issueOrder: Record<CostIssueReason, number> = {
    "unsupported-model": 0,
    "invalid-usage": 1,
    overflow: 2,
  };
  const accountsById = new Map<string, AccountAccumulator>();
  const issueModels = new Map<CostIssueReason, Set<string>>();
  let requestCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let thoughtsTokens = 0;
  let cachedContentTokens = 0;
  let toolUsePromptTokens = 0;
  let totalTokens = 0;
  let estimatedCostUsd = 0;

  for (const result of results) {
    const resultRequestCount = Number(result.requestCount);
    const resultInputTokens = Number(result.inputTokens);
    const resultOutputTokens = Number(result.outputTokens);
    const resultThoughtsTokens = Number(result.thoughtsTokens);
    const resultCachedContentTokens = Number(result.cachedContentTokens);
    const resultToolUsePromptTokens = Number(result.toolUsePromptTokens);
    const resultTotalTokens = Number(result.totalTokens);
    const cost = estimateGeminiCostUsd(
      result.model,
      {
        promptTokenCount: resultInputTokens,
        candidatesTokenCount: resultOutputTokens,
        thoughtsTokenCount: resultThoughtsTokens,
        cachedContentTokenCount: resultCachedContentTokens,
        toolUsePromptTokenCount: resultToolUsePromptTokens,
      },
      result.pricingAt,
    );
    const account = accountsById.get(result.accountId) ?? {
      accountId: result.accountId,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costUnavailable: false,
    };
    account.requestCount += resultRequestCount;
    account.inputTokens += resultInputTokens;
    account.outputTokens += resultOutputTokens;
    if (cost.status === "available") {
      account.costUsd += cost.amountUsd;
      estimatedCostUsd += cost.amountUsd;
    } else {
      account.costUnavailable = true;
      const models = issueModels.get(cost.reason) ?? new Set<string>();
      models.add(result.model);
      issueModels.set(cost.reason, models);
    }
    accountsById.set(result.accountId, account);

    requestCount += resultRequestCount;
    inputTokens += resultInputTokens;
    outputTokens += resultOutputTokens;
    thoughtsTokens += resultThoughtsTokens;
    cachedContentTokens += resultCachedContentTokens;
    toolUsePromptTokens += resultToolUsePromptTokens;
    totalTokens += resultTotalTokens;
  }

  const accounts = [...accountsById.values()]
    .map(({ costUsd, costUnavailable, ...account }) => ({
      ...account,
      estimatedCostUsd: costUnavailable ? null : costUsd,
    }))
    .sort(
      (first, second) =>
        second.inputTokens + second.outputTokens - (first.inputTokens + first.outputTokens) ||
        first.accountId.localeCompare(second.accountId),
    );

  return {
    requestCount,
    inputTokens,
    outputTokens,
    thoughtsTokens,
    cachedContentTokens,
    toolUsePromptTokens,
    totalTokens,
    costEstimate:
      issueModels.size === 0
        ? {
            status: "available",
            currency: "USD",
            amount: estimatedCostUsd,
            pricingAsOf: GEMINI_PRICING_AS_OF,
          }
        : {
            status: "unavailable",
            issues: [...issueModels.entries()]
              .sort(([first], [second]) => issueOrder[first] - issueOrder[second])
              .map(([reason, models]) => ({
                reason,
                models: [...models].sort(),
              })),
          },
    accounts,
  };
}
