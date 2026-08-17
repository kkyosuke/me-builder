import path from "node:path";
import { D1, billing } from "@me-builder/lib";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { reconcileAdminBillingProjection } from "./admin-billing-reconciliation";

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

const current: billing.BillingSubscription = {
  id: "sub_reconcile",
  customerId: "cus_reconcile",
  status: "active",
  priceId: "price_full",
  currentPeriodStart: "2026-08-01T00:00:00.000Z",
  currentPeriodEnd: "2026-09-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  trialEnd: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("admin billing reconciliation", () => {
  it("dry-runでは変更せず、明示修復後の再実行で差分0になる", async () => {
    const db = createTestDb();
    const admin = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_reconcile_admin",
    });
    const target = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_reconcile_target",
    });
    await db
      .update(D1.shared.schema.accounts)
      .set({ role: "admin" })
      .where(eq(D1.shared.schema.accounts.id, admin.account.id));
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: target.account.id,
      providerCustomerId: current.customerId,
    });
    await D1.shared.action.billing.applyBillingProjection(db, {
      accountId: target.account.id,
      event: {
        id: "evt_stale_projection",
        type: "customer.subscription.updated",
        objectId: current.id,
        createdAt: new Date("2026-08-10T00:00:00Z"),
      },
      subscription: {
        ...current,
        id: "sub_stale",
        status: "past_due",
        priceId: "price_lite",
      },
      planCode: "lite",
    });
    const provider = new billing.FakeBillingProvider({ listSubscriptions: async () => [current] });
    const run = (mode: "dry-run" | "apply") =>
      reconcileAdminBillingProjection({
        actor: {
          accountId: admin.account.id,
          authenticationMethod: "liff",
          authenticatedAt: new Date("2026-08-15T00:00:00Z"),
        },
        db,
        provider,
        accountId: target.account.id,
        mode,
        pricePlanMap: { price_full: "full", price_lite: "lite" },
        now: new Date("2026-08-15T00:00:00Z"),
      });

    await expect(run("dry-run")).resolves.toMatchObject({
      type: "resolved",
      reconciliation: {
        differenceFields: expect.arrayContaining(["subscription", "status", "plan"]),
        repaired: false,
      },
    });
    expect(
      await D1.shared.action.billing.findBillingProjectionByAccount(db, target.account.id),
    ).toMatchObject({
      status: "past_due",
      planCode: "lite",
    });

    await expect(run("apply")).resolves.toMatchObject({
      type: "resolved",
      reconciliation: { repaired: true },
    });
    await expect(run("dry-run")).resolves.toMatchObject({
      type: "resolved",
      reconciliation: { differenceFields: [], repaired: false },
    });
    expect(await db.select().from(D1.shared.schema.billingReconciliationAudits).all()).toHaveLength(
      3,
    );
    await expect(
      D1.shared.action.billing.findBillingProjectionByAccount(db, target.account.id),
    ).resolves.toMatchObject({ providerSubscriptionId: current.id });
  });

  it("projection更新がstale拒否された場合は修復済みと報告しない", async () => {
    const db = createTestDb();
    const admin = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_reconcile_stale_admin",
    });
    const target = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "U_reconcile_stale_target",
    });
    await db
      .update(D1.shared.schema.accounts)
      .set({ role: "admin" })
      .where(eq(D1.shared.schema.accounts.id, admin.account.id));
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: target.account.id,
      providerCustomerId: current.customerId,
    });
    await D1.shared.action.billing.applyBillingProjection(db, {
      accountId: target.account.id,
      event: {
        id: "evt_from_future",
        type: "customer.subscription.updated",
        objectId: current.id,
        createdAt: new Date("2026-08-20T00:00:00Z"),
      },
      subscription: { ...current, status: "past_due" },
      planCode: "full",
    });

    const outcome = await reconcileAdminBillingProjection({
      actor: {
        accountId: admin.account.id,
        authenticationMethod: "liff",
        authenticatedAt: new Date("2026-08-15T00:00:00Z"),
      },
      db,
      provider: new billing.FakeBillingProvider({ listSubscriptions: async () => [current] }),
      accountId: target.account.id,
      mode: "apply",
      pricePlanMap: { price_full: "full" },
      now: new Date("2026-08-15T00:00:00Z"),
    });

    expect(outcome).toMatchObject({
      type: "resolved",
      reconciliation: { differenceFields: ["status"], repaired: false },
    });
  });
});
