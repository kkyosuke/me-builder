import type { D1Database } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";

const { getAdminStatistics } = vi.hoisted(() => ({ getAdminStatistics: vi.fn() }));
vi.mock("../logic/admin-statistics", () => ({ getAdminStatistics }));

const dummyDb = {} as D1Database;

describe("GET /api/admin/statistics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("管理者向け統計をキャッシュさせずに返す", async () => {
    getAdminStatistics.mockResolvedValue({
      type: "resolved",
      statistics: {
        period: {
          start: "2026-08-01T00:00:00.000Z",
          end: "2026-09-01T00:00:00.000Z",
        },
        fetchedAt: "2026-08-12T00:00:00.000Z",
        gemini: {
          status: "available",
          requestCount: 1,
          inputTokens: 10,
          outputTokens: 20,
          costEstimate: {
            status: "available",
            currency: "USD",
            amount: 0.000053,
            pricingAsOf: "2026-08-15",
          },
          accounts: [
            {
              accountId: "account-1",
              requestCount: 1,
              inputTokens: 10,
              outputTokens: 20,
              estimatedCostUsd: 0.000053,
            },
          ],
        },
        line: {
          status: "available",
          billableMessages: 1,
          monthlyLimit: 100,
          replyMessages: 1,
        },
      },
    });

    const response = await app.request(
      "/api/admin/statistics",
      { headers: { Authorization: "Bearer dummy.id.token" } },
      { LIFF_ID: "2010850319-Yl63upAR", DB: dummyDb },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      gemini: { accounts: [{ accountId: "account-1" }] },
    });
  });
});
