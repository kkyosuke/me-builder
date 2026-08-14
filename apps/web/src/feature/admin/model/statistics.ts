type StatisticsSection<T> =
  | ({ status: "available" } & T)
  | { status: "unavailable"; reason: "not-configured" | "upstream-error" };

export type AdminStatistics = {
  period: { start: string; end: string };
  fetchedAt: string;
  gemini: StatisticsSection<{
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    costEstimate:
      | { status: "available"; currency: "USD"; amount: number; pricingAsOf: string }
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
  }>;
  line: StatisticsSection<{
    billableMessages: number;
    monthlyLimit: number | null;
    replyMessages: number;
  }>;
};
