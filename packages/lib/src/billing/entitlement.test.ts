import { describe, expect, it } from "vitest";
import {
  type AccountPlanAssignment,
  type AccountPlanAssignmentProvider,
  FakeAccountPlanAssignmentProvider,
  type PlanCode,
} from "./account-plan-assignment";
import { EntitlementService } from "./entitlement";

const NOW = new Date("2026-08-15T00:00:00.000Z");

function assignment(plan: PlanCode): AccountPlanAssignment {
  const familySeat = plan === "family";
  return {
    accountId: "account-1",
    plan,
    source: familySeat ? "family-seat" : plan === "free" ? "free" : "subscription",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    availableUntil: "2026-09-01T00:00:00.000Z",
    payerAccountId: familySeat ? "payer-1" : null,
  };
}

describe("EntitlementService", () => {
  it.each([
    ["free", 20, 12, 30, false, "current-message"],
    ["lite", 150, 12, 365, true, "session-and-diagnosis"],
    ["full", 600, 12, null, true, "confirmed-history"],
    ["family", 600, 12, null, true, "confirmed-history"],
  ] as const)(
    "%sの利用可否と上限をprovider非依存の割当から解決する",
    async (plan, aiLimit, summaryLimit, searchDays, weeklyReflection, relationshipContext) => {
      const service = new EntitlementService(
        new FakeAccountPlanAssignmentProvider([assignment(plan)]),
      );

      const result = await service.resolve("account-1", NOW);

      expect(result).toMatchObject({
        plan,
        resolution: "assignment",
        fallbackReason: null,
        grantedByFamily: plan === "family",
        policy: {
          aiReply: { limit: aiLimit },
          profileSummary: { limit: summaryLimit },
          semanticSearchDays: searchDays,
          relationshipQuestionContext: relationshipContext,
          features: { "weekly-reflection": weeklyReflection },
        },
      });
    },
  );

  it("割当取得失敗はFreeへ安全側に倒す", async () => {
    const provider: AccountPlanAssignmentProvider = {
      findCurrent: async () => {
        throw new Error("projection unavailable");
      },
    };

    await expect(new EntitlementService(provider).resolve("account-1", NOW)).resolves.toMatchObject(
      {
        accountId: "account-1",
        plan: "free",
        resolution: "safe-default",
        fallbackReason: "provider-unavailable",
        grantedByFamily: false,
        policy: { aiReply: { limit: 20 } },
      },
    );
  });

  it.each([
    ["別Account", { ...assignment("full"), accountId: "account-2" }, "invalid-assignment"],
    ["不明Plan", { ...assignment("full"), plan: "unknown" }, "invalid-assignment"],
    [
      "未来の適用開始",
      { ...assignment("full"), effectiveAt: "2026-08-16T00:00:00.000Z" },
      "not-yet-effective",
    ],
    ["期限切れ", { ...assignment("full"), availableUntil: "2026-08-15T00:00:00.000Z" }, "expired"],
    [
      "支払者のないFamily席",
      { ...assignment("family"), payerAccountId: null },
      "invalid-assignment",
    ],
    ["有料PlanのFree付与元", { ...assignment("full"), source: "free" }, "invalid-assignment"],
  ] as const)("%sの割当はFreeへ安全側に倒す", async (_name, invalid, fallbackReason) => {
    const provider: AccountPlanAssignmentProvider = {
      findCurrent: async () => invalid as AccountPlanAssignment,
    };

    await expect(new EntitlementService(provider).resolve("account-1", NOW)).resolves.toMatchObject(
      {
        plan: "free",
        resolution: "safe-default",
        fallbackReason,
      },
    );
  });
});
