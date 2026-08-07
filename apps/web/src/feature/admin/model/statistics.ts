type StatisticsSection<T> =
  | ({ status: "available" } & T)
  | { status: "unavailable"; reason: "not-configured" | "upstream-error" };

export type AdminStatistics = {
  period: { start: string; end: string };
  fetchedAt: string;
  gemini: StatisticsSection<{
    estimatedCostUsd: number;
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  line: StatisticsSection<{
    billableMessages: number;
    monthlyLimit: number | null;
    replyMessages: number;
  }>;
};
