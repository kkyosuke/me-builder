import { D1, billing } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types";
import { accountPlanAssignmentProvider } from "./account-plan-assignment-provider";

const db = {} as Parameters<typeof accountPlanAssignmentProvider>[1];

describe("accountPlanAssignmentProvider", () => {
  it.each(["development", "local", "preview"])(
    "%sでは実Planを保ち全機能を解決する",
    async (environment) => {
      const read = vi
        .spyOn(D1.shared.action.billing.D1AccountPlanAssignmentProvider.prototype, "findCurrent")
        .mockImplementation(async (id, at) => billing.freePlanAssignment(id, at));
      const provider = accountPlanAssignmentProvider({ ENVIRONMENT: environment } as never, db);

      await expect(
        new billing.EntitlementService(provider).resolve("account-1"),
      ).resolves.toMatchObject({
        accountId: "account-1",
        plan: "free",
        source: "free",
        policy: { accountRecovery: true, familySeatLimit: 4 },
      });
      read.mockRestore();
    },
  );

  it("明示的に注入したproviderをLocalでも優先する", () => {
    const injected = new billing.FakeAccountPlanAssignmentProvider();
    const env = {
      ENVIRONMENT: "local",
      ACCOUNT_PLAN_ASSIGNMENT_PROVIDER: injected,
    } as unknown as AppEnv["Bindings"];

    expect(accountPlanAssignmentProvider(env, db)).toBe(injected);
  });

  it.each([undefined, "production"])(
    "ENVIRONMENT=%sでは実Planのproviderを維持する",
    (environment) => {
      const provider = accountPlanAssignmentProvider({ ENVIRONMENT: environment } as never, db);

      expect(provider).toBeInstanceOf(D1.shared.action.billing.D1AccountPlanAssignmentProvider);
    },
  );
});
