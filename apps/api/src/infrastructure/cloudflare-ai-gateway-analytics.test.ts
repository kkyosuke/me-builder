import { describe, expect, it, vi } from "vitest";
import { fetchAiGatewayUsage } from "./cloudflare-ai-gateway-analytics";

describe("fetchAiGatewayUsage", () => {
  it("Gatewayの行をコスト・リクエスト・tokenへ集計する", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        data: {
          viewer: {
            accounts: [
              {
                usage: [
                  {
                    count: 3,
                    sum: {
                      cost: 0.012,
                      cachedTokensIn: 10,
                      cachedTokensOut: 2,
                      uncachedTokensIn: 100,
                      uncachedTokensOut: 40,
                    },
                  },
                ],
              },
            ],
          },
        },
      }),
    );

    await expect(
      fetchAiGatewayUsage({
        apiToken: "token",
        accountId: "account",
        gatewayId: "default",
        start: new Date("2026-08-01T00:00:00Z"),
        end: new Date("2026-08-02T00:00:00Z"),
        fetcher,
      }),
    ).resolves.toEqual({
      estimatedCostUsd: 0.012,
      requestCount: 3,
      inputTokens: 110,
      outputTokens: 42,
    });
  });
});
