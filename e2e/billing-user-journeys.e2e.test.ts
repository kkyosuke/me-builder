import { createHmac } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { BillingQueueMessage, Queue } from "@me-builder/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../apps/api/src";
import { createLocalD1 } from "../apps/api/src/testing/local-d1";
import { convergeBillingEvent } from "../apps/worker/src/handler/billing";
import { D1, billing } from "../packages/lib/src";

const repositoryRoot = path.resolve(__dirname, "..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const stripeWebhookSecret = "whsec_user_journey";
const lineChannelId = "1234567890";
const paidPeriodStart = "2026-08-01T00:00:00.000Z";
const paidPeriodEnd = "2026-09-01T00:00:00.000Z";
type LocalD1 = Awaited<ReturnType<typeof createLocalD1>>;

let localD1: LocalD1;
let database: LocalD1["database"];
let queuedMessages: BillingQueueMessage[];
let currentSubscription: billing.BillingSubscription;

async function applyMigrations(): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of files) {
    const contents = await readFile(path.join(migrationsDirectory, file), "utf8");
    for (const statement of contents
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }
}

function stripeSignature(body: string, timestamp = Math.floor(Date.now() / 1_000)): string {
  const digest = createHmac("sha256", stripeWebhookSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function stripeEvent(input: {
  id: string;
  type: string;
  created: number;
  subscriptionId?: string;
}): string {
  return JSON.stringify({
    id: input.id,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: input.created,
    data: {
      object: {
        id: input.subscriptionId ?? currentSubscription.id,
        object: "subscription",
        customer: currentSubscription.customerId,
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: input.type,
  });
}

async function acceptWebhook(body: string, signature = stripeSignature(body)): Promise<Response> {
  return await app.request(
    "/api/billing/webhook",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
      body,
    },
    {
      DB: database,
      ENVIRONMENT: "test",
      STRIPE_SECRET_KEY: "sk_test_user_journey",
      STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
      BILLING_QUEUE: {
        async send(message: BillingQueueMessage) {
          queuedMessages.push(message);
        },
      } as Queue<BillingQueueMessage>,
    },
  );
}

async function consumeNextBillingMessage(): Promise<"applied" | "duplicate" | "stale" | "ignored"> {
  const message = queuedMessages.shift();
  if (!message) throw new Error("Expected a queued billing message");
  const db = D1.shared.client.create(database);
  return await convergeBillingEvent({
    message,
    provider: new billing.FakeBillingProvider({
      retrieveSubscription: async () => currentSubscription,
    }),
    store: {
      findCustomer: (providerCustomerId) =>
        D1.shared.action.billing.findBillingCustomerByProviderCustomerId(db, providerCustomerId),
      apply: (projection) => D1.shared.action.billing.applyBillingProjection(db, projection),
    },
    resolvePlan: (priceId) => (priceId === "price_full" ? "full" : null),
  });
}

async function createPaidAccount() {
  const db = D1.shared.client.create(database);
  const account = await D1.shared.action.account.upsertIdentity(db, {
    provider: "line_login",
    providerAccountId: "line-paid-user",
  });
  await D1.shared.action.agreement.acceptCurrentTerms(db, account.account.id);
  await D1.shared.action.billing.linkBillingCustomer(db, {
    accountId: account.account.id,
    providerCustomerId: currentSubscription.customerId,
  });
  return { db, account: account.account };
}

function stubLineVerification(): void {
  const subjects: Record<string, string> = {
    "paid-user-token": "line-paid-user",
    "recovered-user-token": "line-recovered-user",
    "conflict-user-token": "line-conflict-user",
    "free-user-token": "line-free-user",
    "attacker-token": "line-attacker",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const idToken = new URLSearchParams(String(init?.body)).get("id_token") ?? "";
      return Response.json({
        iss: "https://access.line.me",
        sub: subjects[idToken] ?? "line-unknown",
        aud: lineChannelId,
        iat: Math.floor(Date.now() / 1_000),
        exp: 4_000_000_000,
      });
    }),
  );
}

describe("billing user journeys E2E", () => {
  beforeEach(async () => {
    localD1 = await createLocalD1(`billing-user-journey-${crypto.randomUUID()}`);
    database = localD1.database;
    queuedMessages = [];
    currentSubscription = {
      id: "sub_user_journey",
      customerId: "cus_user_journey",
      status: "active",
      priceId: "price_full",
      currentPeriodStart: paidPeriodStart,
      currentPeriodEnd: paidPeriodEnd,
      cancelAtPeriodEnd: false,
      trialEnd: null,
      createdAt: paidPeriodStart,
    };
    await applyMigrations();
  }, 90_000);

  afterEach(async () => {
    vi.unstubAllGlobals();
    await localD1.dispose();
  });

  it("有料プラン開始からWebhook反映、再送、解約期限まで利用者のPlanを正しく保つ", async () => {
    const { db, account } = await createPaidAccount();
    const assignment = new D1.shared.action.billing.D1AccountPlanAssignmentProvider(db);
    await expect(
      assignment.findCurrent(account.id, new Date("2026-08-15T00:00:00Z")),
    ).resolves.toMatchObject({ plan: "free" });

    const activated = stripeEvent({
      id: "evt_subscription_activated",
      type: "customer.subscription.created",
      created: 1_786_723_200,
    });
    expect((await acceptWebhook(activated)).status).toBe(200);
    expect(queuedMessages).toHaveLength(1);
    expect(
      await D1.shared.action.billing.findBillingProjectionByAccount(db, account.id),
    ).toBeUndefined();
    await expect(consumeNextBillingMessage()).resolves.toBe("applied");
    await expect(
      assignment.findCurrent(account.id, new Date("2026-08-15T00:00:00Z")),
    ).resolves.toMatchObject({ plan: "full", payerAccountId: account.id });

    expect((await acceptWebhook(activated)).status).toBe(200);
    await expect(consumeNextBillingMessage()).resolves.toBe("duplicate");

    currentSubscription = { ...currentSubscription, cancelAtPeriodEnd: true };
    const cancellationScheduled = stripeEvent({
      id: "evt_cancellation_scheduled",
      type: "customer.subscription.updated",
      created: 1_786_726_800,
    });
    expect((await acceptWebhook(cancellationScheduled)).status).toBe(200);
    await expect(consumeNextBillingMessage()).resolves.toBe("applied");
    await expect(
      assignment.findCurrent(account.id, new Date("2026-08-31T23:59:59Z")),
    ).resolves.toMatchObject({ plan: "full" });
    await expect(
      assignment.findCurrent(account.id, new Date("2026-09-01T00:00:00Z")),
    ).resolves.toMatchObject({ plan: "free" });
  });

  it("改ざんWebhookを拒否し、Free利用者へ誤って有料Planを付与しない", async () => {
    const { db, account } = await createPaidAccount();
    const body = stripeEvent({
      id: "evt_tampered",
      type: "customer.subscription.created",
      created: 1_786_723_200,
    });
    const response = await acceptWebhook(`${body} `, stripeSignature(body));

    expect(response.status).toBe(400);
    expect(queuedMessages).toHaveLength(0);
    await expect(
      new D1.shared.action.billing.D1AccountPlanAssignmentProvider(db).findCurrent(
        account.id,
        new Date("2026-08-15T00:00:00Z"),
      ),
    ).resolves.toMatchObject({ plan: "free" });
  });

  it("LINE Account喪失後も同じ有料Accountへ復旧し、競合と総当たりを拒否する", async () => {
    const { db, account } = await createPaidAccount();
    const activated = stripeEvent({
      id: "evt_recovery_paid",
      type: "customer.subscription.created",
      created: 1_786_723_200,
    });
    await acceptWebhook(activated);
    await consumeNextBillingMessage();
    stubLineVerification();
    const bindings = { DB: database, LINE_LOGIN_CHANNEL_ID: lineChannelId, ENVIRONMENT: "test" };

    const issue = await app.request(
      "/api/account-recovery/codes",
      { method: "POST", headers: { Authorization: "Bearer paid-user-token" } },
      bindings,
    );
    expect(issue.status).toBe(201);
    expect(issue.headers.get("cache-control")).toBe("no-store");
    const { code } = (await issue.json()) as { code: string };

    const recover = await app.request(
      "/api/account-recovery/complete",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer recovered-user-token",
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.10",
        },
        body: JSON.stringify({ code }),
      },
      bindings,
    );
    expect(recover.status).toBe(200);
    expect(await recover.json()).toEqual({ status: "recovered", alreadyRecovered: false });
    const identities = await db.query.accountIdentities.findMany({
      where: (table, { eq }) => eq(table.accountId, account.id),
    });
    expect(identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerAccountId: "line-paid-user", isDeleted: true }),
        expect.objectContaining({ providerAccountId: "line-recovered-user", isDeleted: false }),
      ]),
    );
    await expect(
      new D1.shared.action.billing.D1AccountPlanAssignmentProvider(db).findCurrent(
        account.id,
        new Date("2026-08-15T00:00:00Z"),
      ),
    ).resolves.toMatchObject({ plan: "full", payerAccountId: account.id });

    const retry = await app.request(
      "/api/account-recovery/complete",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer recovered-user-token",
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.10",
        },
        body: JSON.stringify({ code }),
      },
      bindings,
    );
    expect(await retry.json()).toEqual({ status: "recovered", alreadyRecovered: true });

    await D1.shared.action.account.upsertIdentity(db, {
      provider: "line",
      providerAccountId: "line-conflict-user",
    });
    const secondIssue = await app.request(
      "/api/account-recovery/codes",
      { method: "POST", headers: { Authorization: "Bearer recovered-user-token" } },
      bindings,
    );
    const secondCode = ((await secondIssue.json()) as { code: string }).code;
    const conflict = await app.request(
      "/api/account-recovery/complete",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer conflict-user-token",
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.11",
        },
        body: JSON.stringify({ code: secondCode }),
      },
      bindings,
    );
    expect(conflict.status).toBe(409);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invalid = await app.request(
        "/api/account-recovery/complete",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer attacker-token",
            "Content-Type": "application/json",
            "CF-Connecting-IP": "203.0.113.12",
          },
          body: JSON.stringify({ code: "unknown.invalid" }),
        },
        bindings,
      );
      expect(invalid.status).toBe(400);
    }
    const blocked = await app.request(
      "/api/account-recovery/complete",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer attacker-token",
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.12",
        },
        body: JSON.stringify({ code: "unknown.invalid" }),
      },
      bindings,
    );
    expect(blocked.status).toBe(429);
    expect(
      await db.query.accountIdentities.findFirst({
        where: (table, { eq }) => eq(table.providerAccountId, "line-attacker"),
      }),
    ).toBeUndefined();
  }, 20_000);

  it("Customerだけが紐付いたFree利用者には復旧コードを発行しない", async () => {
    const db = D1.shared.client.create(database);
    const free = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-free-user",
    });
    await D1.shared.action.agreement.acceptCurrentTerms(db, free.account.id);
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: free.account.id,
      providerCustomerId: "cus_without_paid_projection",
    });
    stubLineVerification();

    const response = await app.request(
      "/api/account-recovery/codes",
      { method: "POST", headers: { Authorization: "Bearer free-user-token" } },
      { DB: database, LINE_LOGIN_CHANNEL_ID: lineChannelId, ENVIRONMENT: "test" },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Paid contract required" });
  });
});
