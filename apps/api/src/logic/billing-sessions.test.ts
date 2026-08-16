import path from "node:path";
import { D1, billing } from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import {
  createBillingCheckoutSession,
  createBillingPortalSession,
  getBillingCheckoutSessionStatus,
} from "./billing-sessions";

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

async function setup() {
  const db = createTestDb();
  const owner = await D1.shared.action.account.upsertIdentity(db, {
    provider: "line_login",
    providerAccountId: crypto.randomUUID(),
  });
  const createSession = vi.fn().mockResolvedValue({
    type: "resolved",
    session: { accountId: owner.account.id, role: "user" },
  });
  return { db, owner: owner.account, createSession };
}

describe("billing sessions", () => {
  it("server-side lookup key and fixed return URLs are used for checkout", async () => {
    const { db, owner, createSession } = await setup();
    const createCheckoutSession = vi.fn().mockResolvedValue({
      id: "cs_test",
      url: "https://checkout.stripe.test/session",
    });
    const provider = new billing.FakeBillingProvider({ createCheckoutSession });
    await expect(
      createBillingCheckoutSession({
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        provider,
        webOrigin: "https://app.example.test",
        createSession,
        plan: "full",
        interval: "year",
        lookupKeyMap: { "full.year": "full_year_v2" },
      }),
    ).resolves.toEqual({ type: "created", url: "https://checkout.stripe.test/session" });
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: owner.id,
        priceId: "price_full_year_v2",
        successUrl:
          "https://app.example.test/profile/billing?billing=checkout-return&session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "https://app.example.test/profile/billing?billing=checkout-cancel",
        plan: "full",
        interval: "year",
      }),
      `billing-checkout-${owner.id}-initial`,
    );
  });

  it("rejects an unavailable plan", async () => {
    const { db, createSession } = await setup();
    const base = {
      idToken: "token",
      lineLoginChannelId: "channel",
      db,
      provider: new billing.FakeBillingProvider(),
      webOrigin: "https://app.example.test",
      createSession,
      plan: "lite" as const,
      interval: "month" as const,
    };
    await expect(createBillingCheckoutSession({ ...base, lookupKeyMap: {} })).resolves.toEqual({
      type: "unavailable",
      reason: "plan_unavailable",
    });
  });

  it("同じ選択の未完了Checkoutを再利用する", async () => {
    const { db, createSession } = await setup();
    const createCheckoutSession = vi.fn();
    const provider = new billing.FakeBillingProvider({
      findLatestCheckoutSession: async () => ({
        id: "cs_test_open",
        customerId: "cus_test",
        status: "open",
        url: "https://checkout.stripe.test/resume",
        plan: "lite",
        interval: "month",
      }),
      createCheckoutSession,
    });

    await expect(
      createBillingCheckoutSession({
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        provider,
        webOrigin: "https://app.example.test",
        createSession,
        plan: "lite",
        interval: "month",
        lookupKeyMap: { "lite.month": "lite_month" },
      }),
    ).resolves.toEqual({ type: "created", url: "https://checkout.stripe.test/resume" });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("選択が変わった未完了Checkoutを失効させて新しい世代を作る", async () => {
    const { db, owner, createSession } = await setup();
    const expireCheckoutSession = vi.fn();
    const createCheckoutSession = vi.fn().mockResolvedValue({
      id: "cs_test_new",
      url: "https://checkout.stripe.test/new",
    });
    const provider = new billing.FakeBillingProvider({
      findLatestCheckoutSession: async () => ({
        id: "cs_test_old",
        customerId: `cus_${owner.id}`,
        status: "open",
        url: "https://checkout.stripe.test/old",
        plan: "lite",
        interval: "month",
      }),
      expireCheckoutSession,
      createCheckoutSession,
    });

    await expect(
      createBillingCheckoutSession({
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        provider,
        webOrigin: "https://app.example.test",
        createSession,
        plan: "full",
        interval: "year",
        lookupKeyMap: { "full.year": "full_year" },
      }),
    ).resolves.toEqual({ type: "created", url: "https://checkout.stripe.test/new" });
    expect(expireCheckoutSession).toHaveBeenCalledWith("cs_test_old");
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "full", interval: "year" }),
      `billing-checkout-${owner.id}-cs_test_old`,
    );
  });

  it("既存契約がある本人の二重購入を開始しない", async () => {
    const { db, owner, createSession } = await setup();
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: owner.id,
      providerCustomerId: "cus_subscribed",
    });
    await D1.shared.action.billing.applyBillingProjection(db, {
      accountId: owner.id,
      event: {
        id: "evt_subscribed",
        type: "customer.subscription.created",
        objectId: "sub_subscribed",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
      subscription: {
        id: "sub_subscribed",
        customerId: "cus_subscribed",
        status: "active",
        priceId: "price_full",
        currentPeriodStart: "2026-08-01T00:00:00.000Z",
        currentPeriodEnd: "2026-09-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        trialEnd: null,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      planCode: "full",
    });
    const createCheckoutSession = vi.fn();
    await expect(
      createBillingCheckoutSession({
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        provider: new billing.FakeBillingProvider({ createCheckoutSession }),
        webOrigin: "https://app.example.test",
        createSession,
        plan: "lite",
        interval: "month",
        lookupKeyMap: { "lite.month": "lite_month" },
      }),
    ).resolves.toEqual({ type: "unavailable", reason: "existing_subscription" });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("ファミリー席を利用中の本人に個人契約を購入させない", async () => {
    const { db, owner, createSession } = await setup();
    const payer = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: crypto.randomUUID(),
    });
    await D1.shared.action.familySeat.createFamilyPack(db, payer.account.id);
    await D1.shared.action.familySeat.reserveFamilySeat(
      db,
      payer.account.id,
      "family-checkout-guard",
    );
    await D1.shared.action.familySeat.activateFamilySeat(db, "family-checkout-guard", owner.id);
    const createCheckoutSession = vi.fn();

    await expect(
      createBillingCheckoutSession({
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        provider: new billing.FakeBillingProvider({ createCheckoutSession }),
        webOrigin: "https://app.example.test",
        createSession,
        plan: "lite",
        interval: "month",
        lookupKeyMap: { "lite.month": "lite_month" },
      }),
    ).resolves.toEqual({ type: "unavailable", reason: "family_seat_active" });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("creates a portal only for the authenticated Account customer", async () => {
    const { db, owner, createSession } = await setup();
    const other = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: crypto.randomUUID(),
    });
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: owner.id,
      providerCustomerId: "cus_owner",
    });
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: other.account.id,
      providerCustomerId: "cus_other",
    });
    const createPortalSession = vi.fn().mockResolvedValue({
      url: "https://billing.stripe.test/portal",
    });
    const provider = new billing.FakeBillingProvider({ createPortalSession });
    await expect(
      createBillingPortalSession({
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        provider,
        webOrigin: "https://app.example.test",
        createSession,
      }),
    ).resolves.toEqual({ type: "created", url: "https://billing.stripe.test/portal" });
    expect(createPortalSession).toHaveBeenCalledWith({
      customerId: "cus_owner",
      returnUrl: "https://app.example.test/profile?billing=portal-return",
    });
  });

  it("Checkout復帰状態は本人のCustomerに属するSessionだけ返す", async () => {
    const { db, owner, createSession } = await setup();
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: owner.id,
      providerCustomerId: "cus_owner",
    });
    const retrieveCheckoutSession = vi.fn().mockResolvedValue({
      id: "cs_test_completed",
      customerId: "cus_owner",
      status: "complete",
      url: null,
      plan: "lite",
      interval: "month",
    });
    const base = {
      idToken: "token",
      lineLoginChannelId: "channel",
      db,
      provider: new billing.FakeBillingProvider({ retrieveCheckoutSession }),
      webOrigin: "https://app.example.test",
      createSession,
      checkoutSessionId: "cs_test_completed",
    };

    await expect(getBillingCheckoutSessionStatus(base)).resolves.toEqual({
      type: "found",
      status: "complete",
    });
    retrieveCheckoutSession.mockResolvedValueOnce({
      id: "cs_test_other",
      customerId: "cus_other",
      status: "complete",
      url: null,
      plan: null,
      interval: null,
    });
    await expect(
      getBillingCheckoutSessionStatus({ ...base, checkoutSessionId: "cs_test_other" }),
    ).resolves.toEqual({ type: "not-found" });
  });

  it("Customer対応がない本人にはPortalを作成しない", async () => {
    const { db, createSession } = await setup();
    const createPortalSession = vi.fn();
    await expect(
      createBillingPortalSession({
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        provider: new billing.FakeBillingProvider({ createPortalSession }),
        webOrigin: "https://app.example.test",
        createSession,
      }),
    ).resolves.toEqual({ type: "unavailable", reason: "customer_not_found" });
    expect(createPortalSession).not.toHaveBeenCalled();
  });
});
