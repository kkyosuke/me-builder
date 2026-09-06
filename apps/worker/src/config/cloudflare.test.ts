import type { D1Database } from "@cloudflare/workers-types";
import { D1, billing } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import { getCloudflareBindings } from "./cloudflare";

function env(environment: string, provider?: billing.AccountPlanAssignmentProvider): Env {
  return {
    ENVIRONMENT: environment,
    DB: {} as D1Database,
    ...(provider ? { ACCOUNT_PLAN_ASSIGNMENT_PROVIDER: provider } : {}),
  } as Env;
}

describe("getCloudflareBindings plan assignment", () => {
  it.each(["development", "local", "preview"])(
    "%sでは実Planを保ち全機能を解決する",
    async (environment) => {
      const read = vi
        .spyOn(D1.shared.action.billing.D1AccountPlanAssignmentProvider.prototype, "findCurrent")
        .mockImplementation(async (id, at) => billing.freePlanAssignment(id, at));
      const familyRead = vi
        .spyOn(billing.FamilySeatAccountPlanAssignmentProvider.prototype, "findCurrent")
        .mockImplementation(async (id, at) => billing.freePlanAssignment(id, at));
      const cf = getCloudflareBindings(env(environment));
      if (!cf.planAssignmentProvider) throw new Error("Plan provider is missing");

      await expect(
        new billing.EntitlementService(cf.planAssignmentProvider).resolve("account-1"),
      ).resolves.toMatchObject({
        accountId: "account-1",
        plan: "free",
        source: "free",
        policy: { accountRecovery: true, familySeatLimit: 4 },
      });
      read.mockRestore();
      familyRead.mockRestore();
    },
  );

  it("明示的に注入したproviderをLocalでも優先する", async () => {
    const injected = new billing.FakeAccountPlanAssignmentProvider([
      {
        accountId: "account-1",
        plan: "full",
        source: "subscription",
        effectiveAt: "2026-08-01T00:00:00.000Z",
        availableUntil: null,
        payerAccountId: "account-1",
      },
    ]);
    const cf = getCloudflareBindings(env("local", injected));

    await expect(
      cf.planAssignmentProvider?.findCurrent("account-1", new Date("2026-08-15T00:00:00.000Z")),
    ).resolves.toMatchObject({ plan: "full", source: "subscription" });
  });
});
