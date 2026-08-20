import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { BillingSubscription } from "../../../billing";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import { upsertIdentity } from "./account";
import {
  BillingCustomerOwnershipError,
  D1AccountPlanAssignmentProvider,
  applyBillingProjection,
  getBillingOperationalSummary,
  hasUsedBillingTrial,
  linkBillingCustomer,
  replaceBillingCustomer,
} from "./billing";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle migratorをD1 clientと共用するtest adapter。
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
  Object.defineProperty(db, "batch", {
    value: async (queries: Array<{ run: () => unknown }>) =>
      sqlite.transaction(() => queries.map((query) => query.run()))(),
  });
  return db as unknown as SharedD1Client;
}

const subscription: BillingSubscription = {
  id: "sub_1",
  customerId: "cus_1",
  status: "active",
  priceId: "price_full",
  currentPeriodStart: "2026-08-01T00:00:00.000Z",
  currentPeriodEnd: "2026-09-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  trialEnd: null,
  createdAt: "2026-08-01T00:00:00.000Z",
};

async function account(db: SharedD1Client, providerAccountId: string) {
  return (await upsertIdentity(db, { provider: "line_login", providerAccountId })).account;
}

describe("billing projection", () => {
  it("past_dueを最初の失敗から7日だけ維持し、再通知で延長せず回復時に解除する", async () => {
    const db = createTestDb();
    const owner = await account(db, "U_payment_grace");
    await linkBillingCustomer(db, { accountId: owner.id, providerCustomerId: "cus_1" });
    await applyBillingProjection(db, {
      accountId: owner.id,
      event: {
        id: "evt_before_upgrade",
        type: "customer.subscription.updated",
        objectId: "sub_1",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
      subscription: { ...subscription, priceId: "price_lite" },
      planCode: "lite",
    });
    const failed = {
      ...subscription,
      status: "past_due" as const,
      currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    };
    await applyBillingProjection(db, {
      accountId: owner.id,
      event: {
        id: "evt_payment_failed_first",
        type: "invoice.payment_failed",
        objectId: "in_1",
        createdAt: new Date("2026-08-02T00:00:00Z"),
      },
      subscription: failed,
      planCode: "full",
    });
    await applyBillingProjection(db, {
      accountId: owner.id,
      event: {
        id: "evt_payment_failed_retry",
        type: "invoice.payment_failed",
        objectId: "in_1",
        createdAt: new Date("2026-08-08T00:00:00Z"),
      },
      subscription: failed,
      planCode: "full",
    });
    const provider = new D1AccountPlanAssignmentProvider(db);
    await expect(
      provider.findCurrent(owner.id, new Date("2026-08-08T23:59:59Z")),
    ).resolves.toMatchObject({ plan: "lite", availableUntil: "2026-08-09T00:00:00.000Z" });
    await expect(
      provider.findCurrent(owner.id, new Date("2026-08-09T00:00:00Z")),
    ).resolves.toMatchObject({ plan: "free" });

    await applyBillingProjection(db, {
      accountId: owner.id,
      event: {
        id: "evt_payment_recovered",
        type: "invoice.paid",
        objectId: "in_1",
        createdAt: new Date("2026-08-09T01:00:00Z"),
      },
      subscription: { ...failed, status: "active" },
      planCode: "full",
    });
    await expect(
      provider.findCurrent(owner.id, new Date("2026-08-09T01:00:01Z")),
    ).resolves.toMatchObject({ plan: "full" });
    await expect(db.query.billingSubscriptionProjections.findFirst()).resolves.toMatchObject({
      paymentFailureStartedAt: null,
    });
  });

  it.each(["unpaid", "paused", "canceled"] as const)(
    "%sは期間が残っていてもFreeへ戻す",
    async (status) => {
      const db = createTestDb();
      const owner = await account(db, `U_${status}`);
      await linkBillingCustomer(db, { accountId: owner.id, providerCustomerId: "cus_1" });
      await applyBillingProjection(db, {
        accountId: owner.id,
        event: {
          id: `evt_${status}`,
          type: "customer.subscription.updated",
          objectId: "sub_1",
          createdAt: new Date("2026-08-02T00:00:00Z"),
        },
        subscription: { ...subscription, status },
        planCode: "full",
      });

      await expect(
        new D1AccountPlanAssignmentProvider(db).findCurrent(
          owner.id,
          new Date("2026-08-03T00:00:00Z"),
        ),
      ).resolves.toMatchObject({ plan: "free" });
    },
  );

  it.each([
    ["trialing", false, "full", "full"],
    ["active", false, "full", "full"],
    ["active", true, "full", "full"],
    ["incomplete", false, "full", "free"],
    ["incomplete_expired", false, "full", "free"],
    ["active", false, null, "free"],
  ] as const)(
    "status=%s、期間末解約=%s、Plan=%sを期待する%s権限へ変換する",
    async (status, cancelAtPeriodEnd, planCode, expectedPlan) => {
      const db = createTestDb();
      const owner = await account(
        db,
        `U_matrix_${status}_${cancelAtPeriodEnd}_${planCode ?? "unknown"}`,
      );
      await linkBillingCustomer(db, { accountId: owner.id, providerCustomerId: "cus_1" });
      await applyBillingProjection(db, {
        accountId: owner.id,
        event: {
          id: `evt_matrix_${status}_${cancelAtPeriodEnd}_${planCode ?? "unknown"}`,
          type: "customer.subscription.updated",
          objectId: "sub_1",
          createdAt: new Date("2026-08-02T00:00:00Z"),
        },
        subscription: { ...subscription, status, cancelAtPeriodEnd },
        planCode,
      });

      await expect(
        new D1AccountPlanAssignmentProvider(db).findCurrent(
          owner.id,
          new Date("2026-08-03T00:00:00Z"),
        ),
      ).resolves.toMatchObject({ plan: expectedPlan });
    },
  );

  it("trial開始をAccountへ一度だけ記録し、終了後も利用済みと判定する", async () => {
    const db = createTestDb();
    const owner = await account(db, "U_trial_once");
    await linkBillingCustomer(db, { accountId: owner.id, providerCustomerId: "cus_1" });
    await applyBillingProjection(db, {
      accountId: owner.id,
      event: {
        id: "evt_trial_once",
        type: "customer.subscription.updated",
        objectId: "sub_1",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      },
      subscription: {
        ...subscription,
        status: "active",
        trialEnd: "2026-08-15T00:00:00.000Z",
      },
      planCode: "full",
    });

    await expect(hasUsedBillingTrial(db, owner.id)).resolves.toBe(true);
    expect(await db.select().from(schema.billingTrialUsages)).toHaveLength(1);
  });

  it("AccountとCustomerを一意に対応させ、別Accountへの付け替えを拒否する", async () => {
    const db = createTestDb();
    const first = await account(db, "U_billing_1");
    const second = await account(db, "U_billing_2");
    await linkBillingCustomer(db, { accountId: first.id, providerCustomerId: "cus_1" });

    await expect(
      linkBillingCustomer(db, { accountId: second.id, providerCustomerId: "cus_1" }),
    ).rejects.toBeInstanceOf(BillingCustomerOwnershipError);
  });

  it("確認済みの旧Customerだけを新しいCustomerへ置き換える", async () => {
    const db = createTestDb();
    const owner = await account(db, "U_billing_replace");
    await linkBillingCustomer(db, { accountId: owner.id, providerCustomerId: "cus_stale" });

    await expect(
      replaceBillingCustomer(db, {
        accountId: owner.id,
        expectedProviderCustomerId: "cus_stale",
        providerCustomerId: "cus_replacement",
      }),
    ).resolves.toMatchObject({ providerCustomerId: "cus_replacement" });
    await expect(
      replaceBillingCustomer(db, {
        accountId: owner.id,
        expectedProviderCustomerId: "cus_stale",
        providerCustomerId: "cus_other",
      }),
    ).rejects.toBeInstanceOf(BillingCustomerOwnershipError);
  });

  it("重複eventと古いeventで新しいprojectionを巻き戻さない", async () => {
    const db = createTestDb();
    const owner = await account(db, "U_billing_projection");
    await linkBillingCustomer(db, { accountId: owner.id, providerCustomerId: "cus_1" });
    const newer = {
      accountId: owner.id,
      event: {
        id: "evt_new",
        type: "customer.subscription.updated",
        objectId: "sub_1",
        createdAt: new Date("2026-08-15T02:00:00Z"),
      },
      subscription,
      planCode: "full" as const,
    };
    await expect(applyBillingProjection(db, newer)).resolves.toBe("applied");
    await expect(applyBillingProjection(db, newer)).resolves.toBe("duplicate");
    await expect(
      applyBillingProjection(db, {
        ...newer,
        event: { ...newer.event, id: "evt_old", createdAt: new Date("2026-08-15T01:00:00Z") },
        subscription: { ...subscription, status: "canceled" },
        planCode: null,
      }),
    ).resolves.toBe("stale");

    const projection = await db.query.billingSubscriptionProjections.findFirst();
    expect(projection).toMatchObject({ status: "active", planCode: "full" });
  });

  it("同じCustomerのSubscription差し替えへ収束し、旧Subscriptionのeventを拒否する", async () => {
    const db = createTestDb();
    const owner = await account(db, "U_billing_replacement");
    await linkBillingCustomer(db, { accountId: owner.id, providerCustomerId: "cus_1" });
    await applyBillingProjection(db, {
      accountId: owner.id,
      event: {
        id: "evt_initial_subscription",
        type: "customer.subscription.created",
        objectId: "sub_1",
        createdAt: new Date("2026-08-15T01:00:00Z"),
      },
      subscription,
      planCode: "full",
    });

    const replacement = { ...subscription, id: "sub_2", priceId: "price_lite" };
    await expect(
      applyBillingProjection(db, {
        accountId: owner.id,
        event: {
          id: "evt_replacement",
          type: "customer.subscription.created",
          objectId: "sub_2",
          createdAt: new Date("2026-08-15T03:00:00Z"),
        },
        subscription: replacement,
        planCode: "lite",
      }),
    ).resolves.toBe("applied");
    await expect(
      applyBillingProjection(db, {
        accountId: owner.id,
        event: {
          id: "evt_old_subscription",
          type: "customer.subscription.deleted",
          objectId: "sub_1",
          createdAt: new Date("2026-08-15T02:00:00Z"),
        },
        subscription: { ...subscription, status: "canceled" },
        planCode: null,
      }),
    ).resolves.toBe("stale");

    const projections = await db.query.billingSubscriptionProjections.findMany();
    expect(projections).toHaveLength(1);
    expect(projections[0]).toMatchObject({
      providerSubscriptionId: "sub_2",
      status: "active",
      planCode: "lite",
    });
  });

  it("Customer所有者と異なるAccountへのprojection適用を拒否する", async () => {
    const db = createTestDb();
    const owner = await account(db, "U_billing_owner");
    const other = await account(db, "U_billing_intruder");
    await linkBillingCustomer(db, { accountId: owner.id, providerCustomerId: "cus_1" });

    await expect(
      applyBillingProjection(db, {
        accountId: other.id,
        event: {
          id: "evt_wrong_owner",
          type: "customer.subscription.created",
          objectId: "sub_1",
          createdAt: new Date("2026-08-15T01:00:00Z"),
        },
        subscription,
        planCode: "full",
      }),
    ).rejects.toBeInstanceOf(BillingCustomerOwnershipError);
  });

  it("別Accountのprojectionを返さない", async () => {
    const db = createTestDb();
    const owner = await account(db, "U_plan_owner");
    const other = await account(db, "U_plan_other");
    await linkBillingCustomer(db, { accountId: owner.id, providerCustomerId: "cus_1" });
    await applyBillingProjection(db, {
      accountId: owner.id,
      event: {
        id: "evt_plan",
        type: "customer.subscription.created",
        objectId: "sub_1",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
      subscription,
      planCode: "full",
    });

    const provider = new D1AccountPlanAssignmentProvider(db);
    await expect(
      provider.findCurrent(owner.id, new Date("2026-08-15T00:00:00Z")),
    ).resolves.toMatchObject({
      accountId: owner.id,
      plan: "full",
    });
    await expect(
      provider.findCurrent(other.id, new Date("2026-08-15T00:00:00Z")),
    ).resolves.toMatchObject({
      accountId: other.id,
      plan: "free",
    });
  });

  it("projection取得障害では有料権限を付与せずFreeへ倒す", async () => {
    const failingDb = {
      select() {
        throw new Error("D1 unavailable");
      },
    } as unknown as SharedD1Client;
    const provider = new D1AccountPlanAssignmentProvider(failingDb);

    await expect(
      provider.findCurrent("account-with-outage", new Date("2026-08-15T00:00:00Z")),
    ).resolves.toMatchObject({ accountId: "account-with-outage", plan: "free" });
  });

  it("終了済みprojectionと猶予時間内のCustomerを監視遅延に数えない", async () => {
    const db = createTestDb();
    const canceledOwner = await account(db, "U_canceled_subscription");
    await linkBillingCustomer(db, {
      accountId: canceledOwner.id,
      providerCustomerId: "cus_canceled",
      syncedAt: new Date("2026-08-01T00:00:00Z"),
    });
    await applyBillingProjection(db, {
      accountId: canceledOwner.id,
      event: {
        id: "evt_canceled",
        type: "customer.subscription.deleted",
        objectId: "sub_canceled",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
      subscription: {
        ...subscription,
        id: "sub_canceled",
        customerId: "cus_canceled",
        status: "canceled",
      },
      planCode: null,
    });
    const recentOwner = await account(db, "U_recent_customer");
    await linkBillingCustomer(db, {
      accountId: recentOwner.id,
      providerCustomerId: "cus_recent",
      syncedAt: new Date("2026-08-15T00:55:00Z"),
    });

    await expect(
      getBillingOperationalSummary(db, {
        now: new Date("2026-08-15T01:00:00Z"),
        staleAfterMs: 15 * 60 * 1_000,
      }),
    ).resolves.toMatchObject({
      staleProjectionCount: 0,
      customerWithoutProjectionCount: 0,
    });
  });
});
