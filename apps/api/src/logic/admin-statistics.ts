import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { type LineUsage, fetchLineUsage } from "../infrastructure/line-statistics";
import type { AuthenticatedActor } from "./authentication/types";

type UnavailableSection = {
  status: "unavailable";
  reason: "not-configured" | "upstream-error";
};

export type AdminStatisticsOutcome = {
  type: "resolved";
  statistics: {
    period: { start: string; end: string };
    fetchedAt: string;
    gemini:
      | {
          status: "available";
          requestCount: number;
          inputTokens: number;
          outputTokens: number;
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
          accounts: Array<{
            accountId: string;
            requestCount: number;
            inputTokens: number;
            outputTokens: number;
            estimatedCostUsd: number | null;
          }>;
        }
      | UnavailableSection;
    line: ({ status: "available" } & LineUsage) | UnavailableSection;
  };
};

type Params = {
  actor: AuthenticatedActor;
  db: D1.shared.Client;
  lineChannelAccessToken: string | undefined;
  now?: Date;
  getLineUsage?: typeof fetchLineUsage;
  getGeminiUsage?: typeof D1.shared.action.geminiUsage.summarizeGeminiUsage;
};

function startOfJstMonth(now: Date): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return new Date(Date.UTC(year, month - 1, 1) - 9 * 60 * 60 * 1000);
}

export async function getAdminStatistics(params: Params): Promise<AdminStatisticsOutcome> {
  const now = params.now ?? new Date();
  const start = startOfJstMonth(now);
  const geminiPromise = (
    params.getGeminiUsage ?? D1.shared.action.geminiUsage.summarizeGeminiUsage
  )(params.db, start, now);
  const linePromise = params.lineChannelAccessToken
    ? (params.getLineUsage ?? fetchLineUsage)({
        channelAccessToken: params.lineChannelAccessToken,
        now,
      })
    : undefined;
  const [geminiResult, lineResult] = await Promise.allSettled([geminiPromise, linePromise]);

  if (geminiResult.status === "rejected") logger.warn("Failed to fetch Gemini usage statistics");
  if (lineResult.status === "rejected") logger.warn("Failed to fetch LINE usage statistics");

  return {
    type: "resolved",
    statistics: {
      period: { start: start.toISOString(), end: now.toISOString() },
      fetchedAt: now.toISOString(),
      gemini:
        geminiResult.status === "fulfilled"
          ? {
              status: "available",
              requestCount: geminiResult.value.requestCount,
              inputTokens: geminiResult.value.inputTokens,
              outputTokens: geminiResult.value.outputTokens,
              costEstimate: geminiResult.value.costEstimate,
              accounts: geminiResult.value.accounts,
            }
          : { status: "unavailable", reason: "upstream-error" },
      line:
        linePromise === undefined
          ? { status: "unavailable", reason: "not-configured" }
          : lineResult.status === "fulfilled" && lineResult.value
            ? { status: "available", ...lineResult.value }
            : { status: "unavailable", reason: "upstream-error" },
    },
  };
}
