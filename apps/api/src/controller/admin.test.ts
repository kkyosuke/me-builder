import type { D1Database } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";

const { getAdminStatistics } = vi.hoisted(() => ({ getAdminStatistics: vi.fn() }));
const { getAdminAccounts } = vi.hoisted(() => ({ getAdminAccounts: vi.fn() }));
vi.mock("../logic/admin-statistics", () => ({ getAdminStatistics }));
vi.mock("../logic/admin-accounts", () => ({ getAdminAccounts }));
vi.mock("../middleware/authentication", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/authentication")>();
  return {
    ...actual,
    requireAuthentication: async (
      c: Parameters<typeof actual.requireAuthentication>[0],
      next: () => Promise<void>,
    ) => {
      const actor = {
        accountId: "admin-account",
        authenticationMethod: "liff" as const,
        authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      };
      c.set("authenticatedActor", actor);
      c.set("authenticationResult", { type: "authenticated", actor, accountRole: "admin" });
      await next();
    },
  };
});
vi.mock("../middleware/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/authorization")>();
  const pass = async (_c: unknown, next: () => Promise<void>) => next();
  return { ...actual, requireCurrentTerms: pass, requireAdmin: pass };
});

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
      {},
      { LIFF_ID: "2010850319-Yl63upAR", DB: dummyDb },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      gemini: { accounts: [{ accountId: "account-1" }] },
    });
  });
});

describe("GET /api/admin/accounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("検索条件を渡し、管理者向けAccount一覧をキャッシュさせずに返す", async () => {
    getAdminAccounts.mockResolvedValue({
      type: "resolved",
      page: {
        total: 1,
        nextCursor: null,
        accounts: [
          {
            adminReference: "account_0123456789abcdef01234567",
            role: "user",
            status: "active",
            createdAt: "2026-08-01T00:00:00.000Z",
            lastActivityAt: "2026-08-02T00:00:00.000Z",
            plan: "free",
            progression: { status: "pending" },
          },
        ],
      },
    });

    const response = await app.request(
      "/api/admin/accounts?query=%E5%B1%B1%E7%94%B0&role=user&sort=level",
      {},
      { LIFF_ID: "2010850319-Yl63upAR", ENVIRONMENT: "test", DB: dummyDb },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getAdminAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ input: { query: "山田", role: "user", sort: "level" } }),
    );
    expect(await response.json()).toMatchObject({
      accounts: [{ adminReference: "account_0123456789abcdef01234567" }],
    });
  });

  it("不正な検索条件を400として拒否する", async () => {
    const response = await app.request(
      "/api/admin/accounts?role=owner",
      {},
      { LIFF_ID: "2010850319-Yl63upAR", DB: dummyDb },
    );

    expect(response.status).toBe(400);
    expect(getAdminAccounts).not.toHaveBeenCalled();
  });
});
