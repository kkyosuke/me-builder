import { type AccountDataNamespace, type D1, billing } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProfileEntitlement } from "./profile-entitlement";

const actor = {
  accountId: "account-1",
  authenticationMethod: "liff" as const,
  authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
};

const execute = vi.fn(
  async (
    _accountId: string,
    _operation: string,
    _kind: string,
    period: unknown,
    limit: number,
  ) => ({
    kind: _kind,
    period,
    limit,
    reserved: 1,
    committed: 2,
    remaining: Math.max(0, limit - 3),
  }),
);
const accountData = {
  getByName: vi.fn(() => ({ execute })),
} as unknown as AccountDataNamespace;

describe("getProfileEntitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["free", "free", 20, 12],
    ["lite", "subscription", 150, 12],
    ["full", "subscription", 600, 12],
    ["family", "family-seat", 600, 12],
  ] as const)(
    "%s Planの上限と残量を本人向け契約へ返す",
    async (plan, source, aiLimit, summaryLimit) => {
      const provider = new billing.FakeAccountPlanAssignmentProvider([
        {
          accountId: "account-1",
          plan,
          source,
          effectiveAt: "2026-08-01T00:00:00.000Z",
          availableUntil: null,
          payerAccountId:
            source === "family-seat" ? "payer-1" : plan === "free" ? null : "account-1",
        },
      ]);

      const result = await getProfileEntitlement({
        actor,
        db: {} as D1.shared.Client,
        accountData,
        planAssignmentProvider: provider,
        at: new Date("2026-08-15T00:00:00.000Z"),
      });

      expect(result).toMatchObject({
        type: "resolved",
        plan,
        source,
        aiReply: { limit: aiLimit, used: 2, reserved: 1, remaining: aiLimit - 3 },
        profileSummary: {
          limit: summaryLimit,
          used: 2,
          reserved: 1,
          remaining: Math.max(0, summaryLimit - 3),
        },
      });
    },
  );

  it("provider障害時は有料権限を推測せずsafe-defaultを表示する", async () => {
    const result = await getProfileEntitlement({
      actor,
      db: {} as D1.shared.Client,
      accountData,
      planAssignmentProvider: {
        findCurrent: vi.fn().mockRejectedValue(new Error("shared D1 unavailable")),
      },
      at: new Date("2026-08-15T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ type: "resolved", status: "safe-default", plan: "free" });
  });
});
