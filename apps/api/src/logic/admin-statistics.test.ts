import type { d1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getAdminStatistics } from "./admin-statistics";
import type { createLiffSession } from "./liff-session";

const db = {} as d1.Client;
const base = {
  idToken: "id-token",
  lineLoginChannelId: "channel",
  adminLineUserIds: [] as string[],
  db,
  lineChannelAccessToken: "line-token",
  cloudflareAccountId: "cf-account",
  cloudflareAiGatewayId: "default",
  cloudflareAnalyticsApiToken: "cf-token",
  now: new Date("2026-08-08T03:00:00.000Z"),
};

function session(role: "user" | "admin"): typeof createLiffSession {
  return async () => ({ type: "resolved", session: { accountId: "account", role } });
}

describe("getAdminStatistics", () => {
  it("通常Accountには統計を返さない", async () => {
    const getAiUsage = vi.fn();
    const outcome = await getAdminStatistics({
      ...base,
      createSession: session("user"),
      getAiUsage,
    });
    expect(outcome).toEqual({ type: "forbidden" });
    expect(getAiUsage).not.toHaveBeenCalled();
  });

  it("管理者へGeminiとLINEの当月統計を返す", async () => {
    const outcome = await getAdminStatistics({
      ...base,
      createSession: session("admin"),
      getAiUsage: vi.fn().mockResolvedValue({
        estimatedCostUsd: 0.02,
        requestCount: 4,
        inputTokens: 100,
        outputTokens: 20,
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
        gemini: { status: "available", estimatedCostUsd: 0.02 },
        line: { status: "available", billableMessages: 3, replyMessages: 8 },
      },
    });
  });

  it("一方の外部取得失敗でも他方の統計を返す", async () => {
    const outcome = await getAdminStatistics({
      ...base,
      createSession: session("admin"),
      getAiUsage: vi.fn().mockRejectedValue(new Error("Cloudflare unavailable")),
      getLineUsage: vi.fn().mockResolvedValue({
        billableMessages: 3,
        monthlyLimit: null,
        replyMessages: 8,
      }),
    });
    expect(outcome).toMatchObject({
      type: "resolved",
      statistics: {
        gemini: { status: "unavailable", reason: "upstream-error" },
        line: { status: "available" },
      },
    });
  });
});
