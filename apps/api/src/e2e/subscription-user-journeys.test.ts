import path from "node:path";
import { D1, DO, billing } from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptFamilyInvitation,
  getFamilySeatManagement,
  issueFamilySeatInvitation,
  leaveFamilyPack,
} from "../logic/family-seat-management";
import { getPersonalDataFeatures, listPersonalData } from "../logic/personal-data";
import { getProfileEntitlement } from "../logic/profile-entitlement";
import { createAccountDataTestStore } from "../testing/account-data";

function createSharedDb(): D1.shared.Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: D1.shared.schema });
  // biome-ignore lint/suspicious/noExplicitAny: D1 clientと同じmigrationを使うtest adapter。
  migrate(db as any, {
    migrationsFolder: path.resolve(__dirname, "../../../../packages/lib/drizzle"),
  });
  Object.defineProperty(db, "batch", {
    value: async (queries: Array<{ run: () => unknown }>) =>
      sqlite.transaction(() => queries.map((query) => query.run()))(),
  });
  return db as unknown as D1.shared.Client;
}

async function createAccount(db: D1.shared.Client, name: string): Promise<string> {
  return (
    await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: `subscription-journey-${name}`,
    })
  ).account.id;
}

async function projectPlan(
  db: D1.shared.Client,
  input: Readonly<{
    accountId: string;
    customerId: string;
    eventId: string;
    plan: "full" | "family";
    status: "active" | "canceled";
    at: Date;
  }>,
): Promise<void> {
  const existing = await D1.shared.action.billing.findBillingCustomerByAccount(db, input.accountId);
  if (!existing) {
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: input.accountId,
      providerCustomerId: input.customerId,
    });
  }
  await D1.shared.action.billing.applyBillingProjection(db, {
    accountId: input.accountId,
    event: {
      id: input.eventId,
      type:
        input.status === "active"
          ? "customer.subscription.updated"
          : "customer.subscription.deleted",
      objectId: `sub-${input.customerId}`,
      createdAt: input.at,
    },
    subscription: {
      id: `sub-${input.customerId}`,
      customerId: input.customerId,
      status: input.status,
      priceId: `price-${input.plan}`,
      currentPeriodStart: "2026-08-01T00:00:00.000Z",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      trialEnd: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    planCode: input.plan,
    syncedAt: input.at,
  });
}

function effectiveAssignments(db: D1.shared.Client) {
  const subscription = new D1.shared.action.billing.D1AccountPlanAssignmentProvider(db);
  return new billing.FamilyAwareAccountPlanAssignmentProvider(db, subscription);
}

function actor(accountId: string, authenticatedAt = "2026-08-16T00:00:00.000Z") {
  return {
    accountId,
    authenticationMethod: "liff" as const,
    authenticatedAt: new Date(authenticatedAt),
  };
}

async function storeDiary(
  db: DO.account.Database,
  input: Readonly<{ accountId: string; eventId: string; body: string; at: Date }>,
): Promise<void> {
  const source = await DO.account.action.diary.storeLineTextSource(db, {
    accountId: input.accountId,
    eventId: input.eventId,
    body: input.body,
    receivedAt: input.at,
  });
  const sessionId = `session-${input.eventId}`;
  await db.insert(DO.account.schema.conversationSessions).values({
    id: sessionId,
    accountId: input.accountId,
    status: "closed",
    startedAt: input.at,
    lastUserMessageAt: input.at,
    closedAt: input.at,
    closeReason: "explicit",
    nextSequence: 2,
  });
  await db.insert(DO.account.schema.conversationMessages).values({
    id: `message-${input.eventId}`,
    sessionId,
    sequence: 1,
    role: "user",
    sourceRecordId: source.sourceRecordId,
    channel: "line",
  });
}

describe("subscription user journeys", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Full利用者が解約後も保存済みの日記を確認し、本人データを書き出せる", async () => {
    const db = createSharedDb();
    const accountId = await createAccount(db, "full-user");
    const accountData = createAccountDataTestStore();
    accountData.bind(accountId);
    await storeDiary(accountData.db, {
      accountId,
      eventId: "diary-before-downgrade",
      body: "有料期間中に残した大切な日記",
      at: new Date("2026-08-10T00:00:00.000Z"),
    });
    await projectPlan(db, {
      accountId,
      customerId: "cus-full-journey",
      eventId: "evt-full-active",
      plan: "full",
      status: "active",
      at: new Date("2026-08-16T00:00:00.000Z"),
    });
    const assignments = effectiveAssignments(db);

    await expect(
      getProfileEntitlement({
        actor: {
          accountId,
          authenticationMethod: "liff",
          authenticatedAt: new Date("2026-08-16T00:01:00.000Z"),
        },
        db,
        accountData: accountData.namespace,
        planAssignmentProvider: assignments,
        at: new Date("2026-08-16T00:01:00.000Z"),
      }),
    ).resolves.toMatchObject({
      type: "resolved",
      status: "active",
      plan: "full",
      availableUntil: "2026-09-01T00:00:00.000Z",
      aiReply: { limit: 600, remaining: 600 },
    });

    await projectPlan(db, {
      accountId,
      customerId: "cus-full-journey",
      eventId: "evt-full-canceled",
      plan: "full",
      status: "canceled",
      at: new Date("2026-08-20T00:00:00.000Z"),
    });
    await expect(
      new billing.EntitlementService(assignments).resolve(
        accountId,
        new Date("2026-08-20T00:00:01.000Z"),
      ),
    ).resolves.toMatchObject({ plan: "free", source: "free" });

    await expect(
      listPersonalData({
        actor: {
          accountId,
          authenticationMethod: "liff",
          authenticatedAt: new Date("2026-08-20T00:00:01.000Z"),
        },
        accountData: accountData.namespace,
      }),
    ).resolves.toMatchObject({
      type: "resolved",
      records: [{ kind: "diary", value: "有料期間中に残した大切な日記" }],
    });
    const features = await getPersonalDataFeatures({
      actor: {
        accountId,
        authenticationMethod: "liff",
        authenticatedAt: new Date("2026-08-20T00:01:00.000Z"),
      },
      accountData: accountData.namespace,
      at: new Date("2026-08-20T00:01:00.000Z"),
    });
    expect(features).toMatchObject({
      type: "resolved",
      features: {
        format: "kagami-brain-features",
        scopes: ["metadata", "active", "history"],
      },
    });
    expect(JSON.stringify(features)).not.toContain("有料期間中に残した大切な日記");
  });

  it("Family参加者が説明を受けて参加し、退出後も本人の日記を保持する", async () => {
    const db = createSharedDb();
    const payerId = await createAccount(db, "family-payer");
    const memberId = await createAccount(db, "family-member");
    const memberData = createAccountDataTestStore();
    memberData.bind(memberId);
    await storeDiary(memberData.db, {
      accountId: memberId,
      eventId: "private-family-diary",
      body: "支払者には共有しない参加者の日記",
      at: new Date("2026-08-16T00:00:00.000Z"),
    });
    await projectPlan(db, {
      accountId: payerId,
      customerId: "cus-family-journey",
      eventId: "evt-family-active",
      plan: "family",
      status: "active",
      at: new Date("2026-08-16T00:00:00.000Z"),
    });
    await D1.shared.action.familySeat.createFamilyPack(
      db,
      payerId,
      new Date("2026-08-16T00:00:01.000Z"),
    );

    const invitation = await issueFamilySeatInvitation(
      { actor: actor(payerId), db },
      { now: () => new Date("2026-08-16T00:01:00.000Z") },
    );
    if (invitation.type !== "created") throw new Error("Family invitation was not created");

    await expect(
      acceptFamilyInvitation(
        {
          actor: actor(memberId),
          db,
          token: invitation.token,
        },
        { now: () => new Date("2026-08-16T00:02:00.000Z") },
      ),
    ).resolves.toMatchObject({ type: "updated", seat: { role: "member", status: "active" } });

    await expect(
      getProfileEntitlement({
        actor: {
          accountId: memberId,
          authenticationMethod: "liff",
          authenticatedAt: new Date("2026-08-16T00:03:00.000Z"),
        },
        db,
        accountData: memberData.namespace,
        planAssignmentProvider: effectiveAssignments(db),
        at: new Date("2026-08-16T00:03:00.000Z"),
      }),
    ).resolves.toMatchObject({
      type: "resolved",
      status: "active",
      plan: "family",
      source: "family-seat",
      aiReply: { limit: 600 },
    });

    const payerView = await getFamilySeatManagement({
      actor: actor(payerId),
      db,
    });
    expect(JSON.stringify(payerView)).not.toContain(memberId);
    expect(JSON.stringify(payerView)).not.toContain("支払者には共有しない参加者の日記");

    await expect(
      leaveFamilyPack(
        { actor: actor(memberId), db },
        { now: () => new Date("2026-08-16T00:04:00.000Z") },
      ),
    ).resolves.toMatchObject({ type: "updated", seat: { status: "left" } });
    await expect(
      new billing.EntitlementService(effectiveAssignments(db)).resolve(
        memberId,
        new Date("2026-08-16T00:04:01.000Z"),
      ),
    ).resolves.toMatchObject({ plan: "free", source: "free" });
    await expect(
      listPersonalData({
        actor: {
          accountId: memberId,
          authenticationMethod: "liff",
          authenticatedAt: new Date("2026-08-16T00:04:01.000Z"),
        },
        accountData: memberData.namespace,
      }),
    ).resolves.toMatchObject({
      type: "resolved",
      records: [{ kind: "diary", value: "支払者には共有しない参加者の日記" }],
    });
  });
});
