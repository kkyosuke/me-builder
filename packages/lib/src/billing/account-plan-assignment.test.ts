import { describe, expect, it } from "vitest";
import {
  DevelopmentFullPlanAssignmentProvider,
  FakeAccountPlanAssignmentProvider,
  accountPlanAssignmentProviderForEnvironment,
} from "./account-plan-assignment";

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

describe("DevelopmentFullPlanAssignmentProvider", () => {
  it("任意のAccountへ期限なしのFull開発割当を返す", async () => {
    const provider = new DevelopmentFullPlanAssignmentProvider();

    await expect(provider.findCurrent("account-1")).resolves.toEqual({
      accountId: "account-1",
      plan: "full",
      source: "development",
      effectiveAt: "1970-01-01T00:00:00.000Z",
      availableUntil: null,
      payerAccountId: null,
    });
  });

  it.each(["development", "local"])("%sでは開発用Full providerへ差し替える", (environment) => {
    const fallback = new FakeAccountPlanAssignmentProvider();

    expect(accountPlanAssignmentProviderForEnvironment(environment, fallback)).toBeInstanceOf(
      DevelopmentFullPlanAssignmentProvider,
    );
  });

  it.each(["preview", "production", "test", undefined])(
    "%sでは指定されたproviderを維持する",
    (environment) => {
      const fallback = new FakeAccountPlanAssignmentProvider();

      expect(accountPlanAssignmentProviderForEnvironment(environment, fallback)).toBe(fallback);
    },
  );
});
