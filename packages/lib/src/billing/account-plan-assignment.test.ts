import { describe, expect, it } from "vitest";
import { FakeAccountPlanAssignmentProvider } from "./account-plan-assignment";

describe("FakeAccountPlanAssignmentProvider", () => {
  it("returns a provider-independent assignment", async () => {
    const provider = new FakeAccountPlanAssignmentProvider([
      {
        accountId: "account-1",
        plan: "full",
        source: "subscription",
        effectiveAt: "2026-08-01T00:00:00.000Z",
        availableUntil: "2026-09-01T00:00:00.000Z",
        payerAccountId: "account-1",
      },
    ]);

    await expect(
      provider.findCurrent("account-1", new Date("2026-08-15T00:00:00Z")),
    ).resolves.toEqual(expect.objectContaining({ plan: "full", source: "subscription" }));
  });

  it("falls back safely to Free when no current assignment exists", async () => {
    const provider = new FakeAccountPlanAssignmentProvider();
    await expect(
      provider.findCurrent("unknown", new Date("2026-08-15T00:00:00Z")),
    ).resolves.toEqual({
      accountId: "unknown",
      plan: "free",
      source: "free",
      effectiveAt: "2026-08-15T00:00:00.000Z",
      availableUntil: null,
      payerAccountId: null,
    });
  });
});
