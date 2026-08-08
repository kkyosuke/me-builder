import * as v from "valibot";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const AnalyticsResponseSchema = v.object({
  data: v.object({
    viewer: v.object({
      accounts: v.array(
        v.object({
          usage: v.array(
            v.object({
              count: v.number(),
              sum: v.object({
                cost: v.number(),
                cachedTokensIn: v.number(),
                cachedTokensOut: v.number(),
                uncachedTokensIn: v.number(),
                uncachedTokensOut: v.number(),
              }),
            }),
          ),
        }),
      ),
    }),
  }),
});

export type AiGatewayUsage = {
  estimatedCostUsd: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
};

const QUERY = `
query AdminAiGatewayUsage($accountTag: string, $gateway: string, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      usage: aiGatewayRequestsAdaptiveGroups(
        limit: 1000
        filter: { gateway: $gateway, datetimeHour_geq: $start, datetimeHour_leq: $end }
      ) {
        count
        sum {
          cost
          cachedTokensIn
          cachedTokensOut
          uncachedTokensIn
          uncachedTokensOut
        }
      }
    }
  }
}`;

export async function fetchAiGatewayUsage(params: {
  apiToken: string;
  accountId: string;
  gatewayId: string;
  start: Date;
  end: Date;
  fetcher?: Fetcher;
}): Promise<AiGatewayUsage> {
  const response = await (params.fetcher ?? fetch)("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        accountTag: params.accountId,
        gateway: params.gatewayId,
        start: params.start.toISOString(),
        end: params.end.toISOString(),
      },
    }),
  });
  if (!response.ok) throw new Error(`Cloudflare Analytics request failed: ${response.status}`);

  const parsed = v.parse(AnalyticsResponseSchema, await response.json());
  const rows = parsed.data.viewer.accounts[0]?.usage ?? [];
  return rows.reduce<AiGatewayUsage>(
    (total, row) => ({
      estimatedCostUsd: total.estimatedCostUsd + row.sum.cost,
      requestCount: total.requestCount + row.count,
      inputTokens: total.inputTokens + row.sum.cachedTokensIn + row.sum.uncachedTokensIn,
      outputTokens: total.outputTokens + row.sum.cachedTokensOut + row.sum.uncachedTokensOut,
    }),
    { estimatedCostUsd: 0, requestCount: 0, inputTokens: 0, outputTokens: 0 },
  );
}
