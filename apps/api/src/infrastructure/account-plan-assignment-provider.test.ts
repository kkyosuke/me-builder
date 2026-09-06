import { billing } from "@me-builder/lib";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../types";
import { accountPlanAssignmentProvider } from "./account-plan-assignment-provider";

const db = {} as Parameters<typeof accountPlanAssignmentProvider>[1];

describe("accountPlanAssignmentProvider", () => {
  it.each(["development", "local"])("%sでは任意のAccountをFullへ解決する", async (environment) => {
    const provider = accountPlanAssignmentProvider({ ENVIRONMENT: environment } as never, db);

    await expect(provider.findCurrent("account-1")).resolves.toMatchObject({
      accountId: "account-1",
      plan: "full",
      source: "development",
    });
  });

  it("明示的に注入したproviderをLocalでも優先する", () => {
    const injected = new billing.FakeAccountPlanAssignmentProvider();
    const env = {
      ENVIRONMENT: "local",
      ACCOUNT_PLAN_ASSIGNMENT_PROVIDER: injected,
    } as unknown as AppEnv["Bindings"];

    expect(accountPlanAssignmentProvider(env, db)).toBe(injected);
  });
});
