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
    accounts: Array<{
      accountId: string;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
    }>;
  }>;
  line: StatisticsSection<{
    billableMessages: number;
    monthlyLimit: number | null;
    replyMessages: number;
  }>;
};
