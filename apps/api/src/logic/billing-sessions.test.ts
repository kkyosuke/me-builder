import path from "node:path";
import { D1, billing } from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import {
  createBillingCheckoutSession,
  createBillingPlanChangeSession,
  createBillingPortalSession,
  getBillingCheckoutSessionStatus,
  getBillingTrialEligibility,
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
        trialPeriodDays: 14,
      }),
      `billing-checkout-${owner.id}-initial`,
    );
  });

  it("trial使用済みAccountではCustomerが変わっても2回目を付けない", async () => {
    const { db, owner, createSession } = await setup();
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: owner.id,
      providerCustomerId: "cus_previous",
    });
    await D1.shared.action.billing.applyBillingProjection(db, {
      accountId: owner.id,
      event: {
        id: "evt_trial_started",
        type: "customer.subscription.created",
        objectId: "sub_trial",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
      subscription: {
        id: "sub_trial",
        customerId: "cus_previous",
        status: "canceled",
        priceId: "price_lite",
        currentPeriodStart: "2026-08-01T00:00:00.000Z",
        currentPeriodEnd: "2026-08-15T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        trialEnd: "2026-08-15T00:00:00.000Z",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      planCode: "lite",
    });
    const createCheckoutSession = vi.fn().mockResolvedValue({
      id: "cs_paid",
      url: "https://checkout.stripe.test/paid",
    });

    await createBillingCheckoutSession({
      idToken: "token",
      lineLoginChannelId: "channel",
      db,
      provider: new billing.FakeBillingProvider({ createCheckoutSession }),
      webOrigin: "https://app.example.test",
      createSession,
      plan: "full",
      interval: "month",
      lookupKeyMap: { "full.month": "full_month" },
    });

    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ trialPeriodDays: expect.anything() }),
      expect.any(String),
    );
  });

  it("projection反映前でもStripeに有効な契約があれば二重購入を止める", async () => {
    const { db, owner, createSession } = await setup();
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: owner.id,
      providerCustomerId: "cus_active",
    });
    const createCheckoutSession = vi.fn();
    const provider = new billing.FakeBillingProvider({
      listSubscriptions: async () => [
        {
          id: "sub_active",
          customerId: "cus_active",
          status: "active",
          priceId: "price_lite",
          currentPeriodStart: "2026-08-01T00:00:00.000Z",
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          trialEnd: null,
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
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
    ).resolves.toEqual({ type: "unavailable", reason: "existing_subscription" });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("削除済みのsandbox Customerを再作成してCheckoutを継続する", async () => {
    const { db, owner, createSession } = await setup();
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: owner.id,
      providerCustomerId: "cus_stale",
    });
    const createCustomer = vi.fn().mockResolvedValue({ id: "cus_replacement", deleted: false });
    const createCheckoutSession = vi.fn().mockResolvedValue({
      id: "cs_recovered",
      url: "https://checkout.stripe.test/recovered",
    });
    const provider = new billing.FakeBillingProvider({
      retrieveCustomer: async (customerId) => ({
        id: customerId,
        deleted: customerId === "cus_stale",
      }),
      createCustomer,
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
    ).resolves.toEqual({
      type: "created",
      url: "https://checkout.stripe.test/recovered",
    });
    expect(createCustomer).toHaveBeenCalledWith(
      { accountId: owner.id },
      `billing-customer-${owner.id}-cus_stale`,
    );
    await expect(
      D1.shared.action.billing.findBillingCustomerByAccount(db, owner.id),
    ).resolves.toMatchObject({ providerCustomerId: "cus_replacement" });
  });

  it("別sandbox由来で見つからないCustomerも再作成する", async () => {
    const { db, owner, createSession } = await setup();
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: owner.id,
      providerCustomerId: "cus_missing",
    });
    const createCustomer = vi.fn().mockResolvedValue({ id: "cus_current", deleted: false });
    const provider = new billing.FakeBillingProvider({
      retrieveCustomer: async () => {
        throw new billing.BillingProviderError("invalid-request", false, 404);
      },
      createCustomer,
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
    ).resolves.toMatchObject({ type: "created" });
    expect(createCustomer).toHaveBeenCalledOnce();
  });

  it("webhook未反映でもStripeのtrial履歴を再利用不可として扱う", async () => {
    const { db, owner, createSession } = await setup();
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: owner.id,
      providerCustomerId: "cus_trial_history",
    });
    const createCheckoutSession = vi.fn().mockResolvedValue({
      id: "cs_paid",
      url: "https://checkout.stripe.test/paid",
    });
    const provider = new billing.FakeBillingProvider({
      listSubscriptions: async () => [
        {
          id: "sub_canceled_trial",
          customerId: "cus_trial_history",
          status: "canceled",
          priceId: "price_lite",
          currentPeriodStart: "2026-07-01T00:00:00.000Z",
          currentPeriodEnd: "2026-07-15T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          trialEnd: "2026-07-15T00:00:00.000Z",
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ],
      createCheckoutSession,
    });

    await createBillingCheckoutSession({
      idToken: "token",
      lineLoginChannelId: "channel",
      db,
      provider,
      webOrigin: "https://app.example.test",
      createSession,
      plan: "full",
      interval: "month",
      lookupKeyMap: { "full.month": "full_month" },
    });
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ trialPeriodDays: expect.anything() }),
      expect.any(String),
    );
    await expect(
      getBillingTrialEligibility({
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        provider,
        createSession,
      }),
    ).resolves.toEqual({ type: "resolved", eligible: false });
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

  it.each([
    ["lite", "month", "lite", "year", "now"],
    ["lite", "month", "full", "year", "now"],
  ] as const)(
    "%s/%sから%s/%sへの変更にbilling cycle policy %sを使う",
    async (currentPlan, currentInterval, targetPlan, targetInterval, expectedAnchor) => {
      const { db, owner, createSession } = await setup();
      await D1.shared.action.billing.linkBillingCustomer(db, {
        accountId: owner.id,
        providerCustomerId: "cus_change",
      });
      await D1.shared.action.billing.applyBillingProjection(db, {
        accountId: owner.id,
        event: {
          id: "evt_change_source",
          type: "customer.subscription.created",
          objectId: "sub_change",
          createdAt: new Date("2026-08-01T00:00:00Z"),
        },
        subscription: {
          id: "sub_change",
          customerId: "cus_change",
          status: "active",
          priceId: "price_current",
          currentPeriodStart: "2026-08-01T00:00:00.000Z",
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          trialEnd: null,
          createdAt: "2026-08-01T00:00:00.000Z",
        },
        planCode: currentPlan,
      });
      const createPortalSession = vi.fn().mockResolvedValue({
        url: "https://billing.stripe.test/change",
      });
      const provider = new billing.FakeBillingProvider({
        retrieveSubscription: async () => ({
          id: "sub_change",
          itemId: "si_change",
          customerId: "cus_change",
          status: "active",
          priceId: "price_current",
          interval: currentInterval,
          currentPeriodStart: "2026-08-01T00:00:00.000Z",
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          trialEnd: null,
          createdAt: "2026-08-01T00:00:00.000Z",
        }),
        findPriceIdByLookupKey: async () => "price_target",
        createPortalSession,
      });

      await expect(
        createBillingPlanChangeSession({
          idToken: "token",
          lineLoginChannelId: "channel",
          db,
          provider,
          webOrigin: "https://app.example.test",
          createSession,
          plan: targetPlan,
          interval: targetInterval,
          lookupKeyMap: { [`${targetPlan}.${targetInterval}`]: "target_lookup" },
          portalPlanChangeAvailable: true,
          portalResetAvailable: true,
        }),
      ).resolves.toEqual({ type: "created", url: "https://billing.stripe.test/change" });
      expect(createPortalSession).toHaveBeenCalledWith({
        customerId: "cus_change",
        returnUrl: "https://app.example.test/profile/billing?billing=portal-return",
        planChange: {
          subscriptionId: "sub_change",
          itemId: "si_change",
          targetPriceId: "price_target",
          billingCycleAnchor: expectedAnchor,
        },
      });
    },
  );

  it.each([
    ["full", "month", "lite", "month"],
    ["family", "year", "lite", "month"],
    ["full", "year", "family", "month"],
  ] as const)(
    "%s/%sから%s/%sへの期間末変更をSubscription Scheduleへ予約する",
    async (currentPlan, currentInterval, targetPlan, targetInterval) => {
      const { db, owner, createSession } = await setup();
      await D1.shared.action.billing.linkBillingCustomer(db, {
        accountId: owner.id,
        providerCustomerId: "cus_change",
      });
      await D1.shared.action.billing.applyBillingProjection(db, {
        accountId: owner.id,
        event: {
          id: "evt_scheduled_change_source",
          type: "customer.subscription.created",
          objectId: "sub_change",
          createdAt: new Date("2026-08-01T00:00:00Z"),
        },
        subscription: {
          id: "sub_change",
          customerId: "cus_change",
          status: "active",
          priceId: "price_current",
          currentPeriodStart: "2026-08-01T00:00:00.000Z",
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          trialEnd: null,
          createdAt: "2026-08-01T00:00:00.000Z",
        },
        planCode: currentPlan,
      });
      const createPortalSession = vi.fn();
      const scheduleSubscriptionChange = vi.fn().mockResolvedValue({
        effectiveAt: "2026-09-01T00:00:00.000Z",
      });
      const provider = new billing.FakeBillingProvider({
        retrieveSubscription: async () => ({
          id: "sub_change",
          itemId: "si_change",
          scheduleId: null,
          customerId: "cus_change",
          status: "active",
          priceId: "price_current",
          interval: currentInterval,
          currentPeriodStart: "2026-08-01T00:00:00.000Z",
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          trialEnd: null,
          createdAt: "2026-08-01T00:00:00.000Z",
        }),
        findPriceIdByLookupKey: async () => "price_target",
        scheduleSubscriptionChange,
        createPortalSession,
      });

      const outcome = await createBillingPlanChangeSession({
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        provider,
        webOrigin: "https://app.example.test",
        createSession,
        plan: targetPlan,
        interval: targetInterval,
        lookupKeyMap: { [`${targetPlan}.${targetInterval}`]: "target_lookup" },
        portalPlanChangeAvailable: true,
        portalResetAvailable: true,
      });

      expect(outcome.type).toBe("created");
      if (outcome.type !== "created") throw new Error("Expected a scheduled change URL");
      const returnUrl = new URL(outcome.url);
      expect(returnUrl.pathname).toBe("/profile/billing");
      expect(Object.fromEntries(returnUrl.searchParams)).toEqual({
        billing: "change-scheduled",
        plan: targetPlan,
        effective_at: "2026-09-01T00:00:00.000Z",
      });
      expect(scheduleSubscriptionChange).toHaveBeenCalledWith(
        {
          subscriptionId: "sub_change",
          currentPriceId: "price_current",
          targetPriceId: "price_target",
          targetInterval,
        },
        `billing-plan-change-${owner.id}-sub_change-price_target`,
      );
      expect(createPortalSession).not.toHaveBeenCalled();
    },
  );

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
