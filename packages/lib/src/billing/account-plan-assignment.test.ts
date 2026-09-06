import { describe, expect, it } from "vitest";
import {
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

describe("environment plan mapping", () => {
  it.each(["development", "local", "dev", "preview"])(
    "%sは実Planを維持し開発catalogを選択する",
    async (environment) => {
      const fallback = new FakeAccountPlanAssignmentProvider();
      const provider = accountPlanAssignmentProviderForEnvironment(environment, fallback);
      expect(provider.entitlementCatalog).toBe("development");
      await expect(provider.findCurrent("account-1")).resolves.toMatchObject({
        plan: "free",
        source: "free",
      });
    },
  );

  it.each(["production", "test", "unknown", undefined])(
    "%sでは通常catalogを維持する",
    (environment) => {
      const fallback = new FakeAccountPlanAssignmentProvider();
      expect(accountPlanAssignmentProviderForEnvironment(environment, fallback)).toBe(fallback);
    },
  );

  it("課金検証の明示設定は開発環境でも通常catalogへ戻せる", () => {
    const fallback = new FakeAccountPlanAssignmentProvider();
    expect(accountPlanAssignmentProviderForEnvironment("preview", fallback, "standard")).toBe(
      fallback,
    );
  });

  it.each(["production", "unknown", undefined])("%sで開発catalogを指定できない", (environment) => {
    expect(() =>
      accountPlanAssignmentProviderForEnvironment(
        environment,
        new FakeAccountPlanAssignmentProvider(),
        "development",
      ),
    ).toThrow("Invalid ENTITLEMENT_CATALOG");
  });

  it("不明なcatalog名を拒否する", () => {
    expect(() =>
      accountPlanAssignmentProviderForEnvironment(
        "local",
        new FakeAccountPlanAssignmentProvider(),
        "typo",
      ),
    ).toThrow("Invalid ENTITLEMENT_CATALOG");
  });
});
