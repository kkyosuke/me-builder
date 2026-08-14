import type { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getAdminStatistics } from "./admin-statistics";
import type { createLiffSession } from "./liff-session";

const db = {} as D1.shared.Client;
const base = {
  idToken: "id-token",
  lineLoginChannelId: "channel",
  adminLineUserIds: [] as string[],
  db,
  lineChannelAccessToken: "line-token",
  now: new Date("2026-08-08T03:00:00.000Z"),
};

function session(role: "user" | "admin"): typeof createLiffSession {
  return async () => ({ type: "resolved", session: { accountId: "account", role } });
}

describe("getAdminStatistics", () => {
  it("通常Accountには統計を返さない", async () => {
    const outcome = await getAdminStatistics({
      ...base,
      createSession: session("user"),
    });
    expect(outcome).toEqual({ type: "forbidden" });
  });

  it("管理者へGeminiとLINEの当月統計を返す", async () => {
    const outcome = await getAdminStatistics({
      ...base,
      createSession: session("admin"),
      getGeminiUsage: vi.fn().mockResolvedValue({
        requestCount: 2,
        inputTokens: 120,
        outputTokens: 40,
        costEstimate: {
          status: "available",
          currency: "USD",
          amount: 0.000136,
          pricingAsOf: "2026-08-15",
        },
        accounts: [
          {
            accountId: "account-1",
            requestCount: 2,
            inputTokens: 120,
            outputTokens: 40,
            estimatedCostUsd: 0.000136,
          },
        ],
      }),
      getLineUsage: vi.fn().mockResolvedValue({
        billableMessages: 3,
        monthlyLimit: 5000,
        replyMessages: 8,
      }),
    });
    expect(outcome).toMatchObject({
      type: "resolved",
      statistics: {
        gemini: {
          status: "available",
          requestCount: 2,
          inputTokens: 120,
          outputTokens: 40,
          costEstimate: { status: "available", amount: 0.000136 },
          accounts: [{ accountId: "account-1" }],
        },
        line: { status: "available", billableMessages: 3, replyMessages: 8 },
      },
    });
  });

  it("LINEの取得失敗時もGeminiの統計を返す", async () => {
    const outcome = await getAdminStatistics({
      ...base,
      createSession: session("admin"),
      getGeminiUsage: vi.fn().mockResolvedValue({
        requestCount: 2,
        inputTokens: 120,
        outputTokens: 40,
        costEstimate: {
          status: "available",
          currency: "USD",
          amount: 0.000136,
          pricingAsOf: "2026-08-15",
        },
        accounts: [
          {
            accountId: "account-1",
            requestCount: 2,
            inputTokens: 120,
            outputTokens: 40,
            estimatedCostUsd: 0.000136,
          },
        ],
      }),
      getLineUsage: vi.fn().mockRejectedValue(new Error("LINE unavailable")),
    });
    expect(outcome).toMatchObject({
      type: "resolved",
      statistics: {
        gemini: {
          status: "available",
          requestCount: 2,
          inputTokens: 120,
          outputTokens: 40,
          accounts: [{ accountId: "account-1" }],
        },
        line: { status: "unavailable", reason: "upstream-error" },
      },
    });
  });

  it("Gemini集計の取得失敗時もLINEの統計を返す", async () => {
    const outcome = await getAdminStatistics({
      ...base,
      createSession: session("admin"),
      getGeminiUsage: vi.fn().mockRejectedValue(new Error("D1 unavailable")),
      getLineUsage: vi.fn().mockResolvedValue({
        billableMessages: 3,
        monthlyLimit: 5000,
        replyMessages: 8,
      }),
    });
    expect(outcome).toMatchObject({
      type: "resolved",
      statistics: {
        gemini: { status: "unavailable", reason: "upstream-error" },
        line: { status: "available", billableMessages: 3, replyMessages: 8 },
      },
    });
  });
});
