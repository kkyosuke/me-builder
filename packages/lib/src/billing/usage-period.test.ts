import { describe, expect, it } from "vitest";
import { FakeAccountPlanAssignmentProvider } from "./account-plan-assignment";
import { EntitlementService } from "./entitlement";
import { resolveEntitlementUsagePeriod } from "./usage-period";

describe("resolveEntitlementUsagePeriod", () => {
  it("FreeのAI返信をUTC暦月へ解決する", async () => {
    const at = new Date("2026-08-15T12:00:00.000Z");
    const entitlement = await new EntitlementService(
      new FakeAccountPlanAssignmentProvider(),
    ).resolve("account-1", at);

    expect(resolveEntitlementUsagePeriod(entitlement, "ai-reply", at)).toEqual({
      key: "free-month:2026-08",
      start: new Date("2026-08-01T00:00:00.000Z"),
      end: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  it("契約開始日を基準に月末をclampして次の期間へ進む", async () => {
    const entitlement = await new EntitlementService(
      new FakeAccountPlanAssignmentProvider([
        {
          accountId: "account-1",
          plan: "full",
          source: "subscription",
          effectiveAt: "2026-01-31T10:30:00.000Z",
          availableUntil: null,
          payerAccountId: "account-1",
        },
      ]),
    ).resolve("account-1", new Date("2026-03-15T00:00:00.000Z"));

    expect(
      resolveEntitlementUsagePeriod(entitlement, "ai-reply", new Date("2026-03-15T00:00:00.000Z")),
    ).toEqual({
      key: "assignment-month:2026-01-31T10:30:00.000Z:1",
      start: new Date("2026-02-28T10:30:00.000Z"),
      end: new Date("2026-03-31T10:30:00.000Z"),
    });
  });
});
