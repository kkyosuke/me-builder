import path from "node:path";
import { D1, billing } from "@me-builder/lib";
import type { BillingQueueMessage } from "@me-builder/shared";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { convergeBillingEvent } from "../handler/billing";

function createTestDb(): D1.shared.Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: D1.shared.schema });
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle migratorをD1 clientと共用するtest adapter。
  migrate(db as any, {
    migrationsFolder: path.resolve(__dirname, "../../../../packages/lib/drizzle"),
  });
  Object.defineProperty(db, "batch", {
    value: async (queries: Array<{ run: () => unknown }>) =>
      sqlite.transaction(() => queries.map((query) => query.run()))(),
  });
  return db as unknown as D1.shared.Client;
}

function message(sequence: number, eventId = `evt-${sequence}`): BillingQueueMessage {
  return {
    type: "billing-event",
    version: 1,
    traceId: `trace-${sequence}`,
    eventId,
    eventType: "customer.subscription.updated",
    objectId: "sub-lifecycle",
    objectType: "subscription",
    customerId: "cus-lifecycle",
    subscriptionId: "sub-lifecycle",
    createdAt: new Date(Date.UTC(2026, 7, sequence + 1)).toISOString(),
  };
}

describe("billing lifecycle E2E foundation", () => {
  it("purchaseからtrial、変更、支払失敗・回復、解約まで同じAccountへ収束する", async () => {
    const db = createTestDb();
    const owner = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "billing-lifecycle-owner",
    });
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: owner.account.id,
      providerCustomerId: "cus-lifecycle",
    });
    let current: billing.BillingSubscription = {
      id: "sub-lifecycle",
      customerId: "cus-lifecycle",
      status: "trialing",
      priceId: "price-lite",
      currentPeriodStart: "2026-08-01T00:00:00.000Z",
      currentPeriodEnd: "2026-08-15T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      trialEnd: "2026-08-15T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const provider = new billing.FakeBillingProvider({
      retrieveSubscription: async () => current,
    });
    const store = {
      findCustomer: (providerCustomerId: string) =>
        D1.shared.action.billing.findBillingCustomerByProviderCustomerId(db, providerCustomerId),
      apply: (input: Parameters<typeof D1.shared.action.billing.applyBillingProjection>[1]) =>
        D1.shared.action.billing.applyBillingProjection(db, input),
    };
    const run = (sequence: number, eventId?: string) =>
      convergeBillingEvent({
        message: message(sequence, eventId),
        provider,
        store,
        resolvePlan: (priceId) =>
          priceId === "price-lite" ? "lite" : priceId === "price-full" ? "full" : null,
      });
    const assignments = new D1.shared.action.billing.D1AccountPlanAssignmentProvider(db);

    await expect(run(1)).resolves.toBe("applied");
    await expect(
      assignments.findCurrent(owner.account.id, new Date("2026-08-03T00:00:00Z")),
    ).resolves.toMatchObject({ plan: "lite", source: "subscription" });
    current = { ...current, status: "active", trialEnd: null };
    await expect(run(2)).resolves.toBe("applied");
    current = { ...current, priceId: "price-full" };
    await expect(run(3)).resolves.toBe("applied");
    await expect(
      assignments.findCurrent(owner.account.id, new Date("2026-08-04T00:00:00Z")),
    ).resolves.toMatchObject({ plan: "full", source: "subscription" });
    current = { ...current, status: "past_due" };
    await expect(run(4)).resolves.toBe("applied");
    await expect(
      assignments.findCurrent(owner.account.id, new Date("2026-08-05T00:00:00Z")),
    ).resolves.toMatchObject({ plan: "free", source: "free" });
    current = { ...current, status: "active" };
    await expect(run(5)).resolves.toBe("applied");
    current = { ...current, priceId: "price-lite", cancelAtPeriodEnd: true };
    await expect(run(6)).resolves.toBe("applied");
    current = { ...current, status: "canceled", cancelAtPeriodEnd: false };
    await expect(run(7)).resolves.toBe("applied");
    await expect(run(7)).resolves.toBe("duplicate");
    await expect(run(2)).resolves.toBe("duplicate");
    await expect(run(2, "evt-stale-after-cancel")).resolves.toBe("stale");

    await expect(
      D1.shared.action.billing.findBillingProjectionByAccount(db, owner.account.id),
    ).resolves.toMatchObject({
      accountId: owner.account.id,
      status: "canceled",
      planCode: "lite",
    });
    await expect(
      assignments.findCurrent(owner.account.id, new Date("2026-08-08T00:00:00Z")),
    ).resolves.toMatchObject({ plan: "free", source: "free" });
  });
});
