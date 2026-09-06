import type { D1Database } from "@cloudflare/workers-types";
import { billing } from "@me-builder/lib";
import { describe, expect, it } from "vitest";
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
  it.each(["development", "local"])("%sでは任意のAccountをFullへ解決する", async (environment) => {
    const cf = getCloudflareBindings(env(environment));

    await expect(cf.planAssignmentProvider?.findCurrent("account-1")).resolves.toMatchObject({
      accountId: "account-1",
      plan: "full",
      source: "development",
    });
  });

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
