import { createHmac } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { BillingQueueMessage, Queue } from "@me-builder/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../apps/api/src";
import { createApplicationSessionFixture } from "../apps/api/src/testing/application-session";
import { createLocalD1 } from "../apps/api/src/testing/local-d1";
import { convergeBillingEvent } from "../apps/worker/src/handler/billing";
import { D1, billing } from "../packages/lib/src";
import { logger } from "../packages/shared/src";

const repositoryRoot = path.resolve(__dirname, "..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const stripeWebhookSecret = "whsec_user_journey";
const paidPeriodStart = "2026-08-01T00:00:00.000Z";
const paidPeriodEnd = "2026-09-01T00:00:00.000Z";
type LocalD1 = Awaited<ReturnType<typeof createLocalD1>>;

let localD1: LocalD1;
let database: LocalD1["database"];
let queuedMessages: BillingQueueMessage[];
let currentSubscription: billing.BillingSubscription;
let sessionFixture: ReturnType<typeof createApplicationSessionFixture>;

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

function keepCurrentSubscriptionActiveForRecovery(): void {
  const now = Date.now();
  const currentPeriodStart = new Date(now - 24 * 60 * 60 * 1_000).toISOString();
  currentSubscription = {
    ...currentSubscription,
    currentPeriodStart,
    currentPeriodEnd: new Date(now + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    createdAt: currentPeriodStart,
  };
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
    sessionFixture = createApplicationSessionFixture(database);
  }, 90_000);

  afterEach(async () => {
    vi.restoreAllMocks();
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
    keepCurrentSubscriptionActiveForRecovery();
    const activated = stripeEvent({
      id: "evt_recovery_paid",
      type: "customer.subscription.created",
      created: 1_786_723_200,
    });
    await acceptWebhook(activated);
    await consumeNextBillingMessage();
    const recovered = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-recovered-user",
    });
    const attacker = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-attacker",
    });
    const paidSession = await sessionFixture.issue(account.id);
    const recoveredSession = await sessionFixture.issue(recovered.account.id);
    const attackerSession = await sessionFixture.issue(attacker.account.id);
    const bindings = { DB: database, ...sessionFixture.bindings, ENVIRONMENT: "test" };

    const issue = await app.request(
      "/api/account-recovery/codes",
      { method: "POST", headers: paidSession.headers },
      bindings,
    );
    expect(issue.status).toBe(201);
    expect(issue.headers.get("cache-control")).toBe("no-store");
    const { code } = (await issue.json()) as { code: string };

    const recoverResponse = await app.request(
      "/api/account-recovery/complete",
      {
        method: "POST",
        headers: {
          ...recoveredSession.headers,
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.10",
        },
        body: JSON.stringify({ code }),
      },
      bindings,
    );
    expect(recoverResponse.status).toBe(200);
    expect(await recoverResponse.json()).toEqual({ status: "recovered", alreadyRecovered: false });
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

    const refreshedRecoveredSession = await sessionFixture.issue(account.id);
    const retry = await app.request(
      "/api/account-recovery/complete",
      {
        method: "POST",
        headers: {
          ...refreshedRecoveredSession.headers,
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.10",
        },
        body: JSON.stringify({ code }),
      },
      bindings,
    );
    expect(await retry.json()).toEqual({ status: "recovered", alreadyRecovered: true });
    const activeRecoveredSession = await sessionFixture.issue(account.id);

    await D1.shared.action.account.upsertIdentity(db, {
      provider: "line",
      providerAccountId: "line-conflict-user",
    });
    const conflictSourceAccountId = crypto.randomUUID();
    const conflictTimestamp = Math.floor(Date.now() / 1_000);
    await database
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status, role)
         VALUES (?, ?, ?, 0, 'active', 'user')`,
      )
      .bind(conflictSourceAccountId, conflictTimestamp, conflictTimestamp)
      .run();
    await database
      .prepare(
        `INSERT INTO account_identities (
           id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
         ) VALUES (?, ?, ?, 0, ?, 'line_login', ?)`,
      )
      .bind(
        crypto.randomUUID(),
        conflictTimestamp,
        conflictTimestamp,
        conflictSourceAccountId,
        "line-conflict-user",
      )
      .run();
    const conflictSession = await sessionFixture.issue(conflictSourceAccountId);
    const secondIssue = await app.request(
      "/api/account-recovery/codes",
      { method: "POST", headers: activeRecoveredSession.headers },
      bindings,
    );
    const secondCode = ((await secondIssue.json()) as { code: string }).code;
    const conflict = await app.request(
      "/api/account-recovery/complete",
      {
        method: "POST",
        headers: {
          ...conflictSession.headers,
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
            ...attackerSession.headers,
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
          ...attackerSession.headers,
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
    ).toMatchObject({ accountId: attacker.account.id, isDeleted: false });
  }, 30_000);

  it("旧コード・期限切れを拒否し、2ブラウザの同時復旧でもAccountとPlanを一方だけへ継続する", async () => {
    const infoLog = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const warnLog = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const { db, account } = await createPaidAccount();
    keepCurrentSubscriptionActiveForRecovery();
    await acceptWebhook(
      stripeEvent({
        id: "evt_recovery_race_paid",
        type: "customer.subscription.created",
        created: 1_786_723_200,
      }),
    );
    await consumeNextBillingMessage();

    const browserA = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-recovery-browser-a",
    });
    const browserB = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-recovery-browser-b",
    });
    const targetBrowserA = await sessionFixture.issue(account.id);
    const targetBrowserB = await sessionFixture.issue(account.id);
    const sourceBrowserA = await sessionFixture.issue(browserA.account.id);
    const sourceBrowserB = await sessionFixture.issue(browserB.account.id);
    const bindings = { DB: database, ...sessionFixture.bindings, ENVIRONMENT: "test" };

    const issueCode = async (headers: Record<string, string>) => {
      const response = await app.request(
        "/api/account-recovery/codes",
        { method: "POST", headers },
        bindings,
      );
      expect(response.status).toBe(201);
      return ((await response.json()) as { code: string }).code;
    };
    const recover = async (headers: Record<string, string>, code: string, ip: string) =>
      await app.request(
        "/api/account-recovery/complete",
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "CF-Connecting-IP": ip,
          },
          body: JSON.stringify({ code }),
        },
        bindings,
      );
    const sessionStatus = async (cookie: string) =>
      (
        await app.request(
          "/api/auth/session",
          { headers: { Cookie: cookie, Origin: "https://web.example" } },
          bindings,
        )
      ).status;

    const oldCode = await issueCode(targetBrowserA.headers);
    const expiringCode = await issueCode(targetBrowserB.headers);
    expect((await recover(sourceBrowserA.headers, oldCode, "203.0.113.20")).status).toBe(400);

    const [expiringCredentialId] = expiringCode.split(".");
    if (!expiringCredentialId) throw new Error("Expected an expiring recovery credential ID");
    await database
      .prepare("UPDATE account_recovery_credentials SET expires_at = ? WHERE id = ?")
      .bind(Math.floor((Date.now() - 1_000) / 1_000), expiringCredentialId)
      .run();
    expect((await recover(sourceBrowserB.headers, expiringCode, "203.0.113.21")).status).toBe(400);
    const rateLimitRows = await db.query.accountRecoveryRateLimits.findMany();
    expect(rateLimitRows).toHaveLength(4);
    expect(rateLimitRows.every((row) => /^[A-Za-z0-9_-]{43}$/.test(row.keyHash))).toBe(true);
    expect(JSON.stringify(rateLimitRows)).not.toMatch(
      /203\.0\.113\.(?:20|21)|line-recovery-browser-[ab]/u,
    );

    const activeCode = await issueCode(targetBrowserA.headers);
    const [credentialId, secret] = activeCode.split(".");
    if (!credentialId || !secret) throw new Error("Expected a recovery credential and secret");
    const storedCredential = await db.query.accountRecoveryCredentials.findFirst({
      where: (table, { eq }) => eq(table.id, credentialId),
    });
    expect(storedCredential).toMatchObject({
      accountId: account.id,
      usedAt: null,
      revokedAt: null,
    });
    expect(storedCredential?.secretHash).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(storedCredential?.secretHash).not.toContain(secret);
    expect(JSON.stringify(storedCredential)).not.toContain(activeCode);

    const responses = await Promise.all([
      recover(sourceBrowserA.headers, activeCode, "203.0.113.22"),
      recover(sourceBrowserB.headers, activeCode, "203.0.113.23"),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    const winner = responses.findIndex((response) => response.status === 200);
    expect(await responses[winner]?.json()).toEqual({
      status: "recovered",
      alreadyRecovered: false,
    });

    expect(await sessionStatus(targetBrowserA.cookie)).toBe(401);
    expect(await sessionStatus(targetBrowserB.cookie)).toBe(401);
    const sourceSessions = [sourceBrowserA, sourceBrowserB];
    expect(await sessionStatus(sourceSessions[winner]?.cookie ?? "")).toBe(401);
    expect(await sessionStatus(sourceSessions[winner === 0 ? 1 : 0]?.cookie ?? "")).toBe(200);

    const winningIdentity = winner === 0 ? browserA.identity.id : browserB.identity.id;
    await expect(
      db.query.accountIdentities.findFirst({
        where: (table, { eq }) => eq(table.id, winningIdentity),
      }),
    ).resolves.toMatchObject({ accountId: account.id, isDeleted: false });
    await expect(
      db.query.accounts.findFirst({
        where: (table, { eq }) => eq(table.id, account.id),
      }),
    ).resolves.toMatchObject({ id: account.id, status: "active", isDeleted: false });
    await expect(
      new D1.shared.action.billing.D1AccountPlanAssignmentProvider(db).findCurrent(
        account.id,
        new Date("2026-08-15T00:00:00Z"),
      ),
    ).resolves.toMatchObject({ plan: "full", payerAccountId: account.id });

    const serializedLogs = JSON.stringify([
      ...infoLog.mock.calls,
      ...warnLog.mock.calls,
      ...errorLog.mock.calls,
    ]);
    for (const sensitiveValue of [oldCode, expiringCode, activeCode, secret]) {
      expect(serializedLogs).not.toContain(sensitiveValue);
    }
  }, 30_000);

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
    const freeSession = await sessionFixture.issue(free.account.id);

    const response = await app.request(
      "/api/account-recovery/codes",
      { method: "POST", headers: freeSession.headers },
      { DB: database, ...sessionFixture.bindings, ENVIRONMENT: "test" },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Paid contract required" });
  });
});
