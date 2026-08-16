import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { upsertIdentity } from "../d1/shared/action/account";
import {
  activateFamilySeat,
  createFamilyPack,
  endFamilyPack,
  leaveFamilySeat,
  reserveFamilySeat,
} from "../d1/shared/action/family-seat";
import type { SharedD1Client } from "../d1/shared/client";
import * as schema from "../d1/shared/schema";
import { FakeAccountPlanAssignmentProvider } from "./account-plan-assignment";
import { EntitlementService } from "./entitlement";
import {
  FamilyAwareAccountPlanAssignmentProvider,
  FamilySeatAccountPlanAssignmentProvider,
} from "./family-seat-assignment-provider";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: better-sqlite3 adapter for D1 migration tests.
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      let results: unknown[] = [];
      sqlite.transaction(() => {
        results = queries.map((query) => (query as { run: () => unknown }).run());
      })();
      return results;
    },
  });
  return db as unknown as SharedD1Client;
}

async function account(db: SharedD1Client, name: string): Promise<string> {
  return (await upsertIdentity(db, { provider: "line", providerAccountId: `U_${name}` })).account
    .id;
}

describe("FamilySeatAccountPlanAssignmentProvider", () => {
  it("参加中の3 AccountへFull相当を付与し、退出・契約終了でFreeへ戻す", async () => {
    const db = createTestDb();
    const payer = await account(db, "payer");
    const members = await Promise.all(
      ["member-a", "member-b", "member-c"].map((name) => account(db, name)),
    );
    const outsider = await account(db, "outsider");
    const joinedAt = new Date("2026-08-16T00:00:00.000Z");
    await createFamilyPack(db, payer, joinedAt);
    await Promise.all(
      members.map((_, index) => reserveFamilySeat(db, payer, `invite-${index}`, joinedAt)),
    );
    await Promise.all(
      members.map((member, index) => activateFamilySeat(db, `invite-${index}`, member, joinedAt)),
    );
    const service = new EntitlementService(new FamilyAwareAccountPlanAssignmentProvider(db));

    for (const member of members) {
      await expect(service.resolve(member, joinedAt)).resolves.toMatchObject({
        plan: "family",
        source: "family-seat",
        grantedByFamily: true,
        payerAccountId: payer,
        policy: {
          aiReply: { limit: 600 },
          profileSummary: { limit: 12 },
          relationshipQuestionContext: "confirmed-history",
        },
      });
    }
    await expect(service.resolve(outsider, joinedAt)).resolves.toMatchObject({ plan: "free" });

    const leavingMember = members[0];
    if (!leavingMember) throw new Error("member fixture is missing");
    await leaveFamilySeat(db, leavingMember, new Date("2026-08-16T01:00:00.000Z"));
    await expect(
      service.resolve(leavingMember, new Date("2026-08-16T01:00:01.000Z")),
    ).resolves.toMatchObject({
      plan: "free",
      grantedByFamily: false,
    });

    await endFamilyPack(db, payer, new Date("2026-08-16T02:00:00.000Z"));
    for (const member of members.slice(1)) {
      await expect(
        service.resolve(member, new Date("2026-08-16T02:00:01.000Z")),
      ).resolves.toMatchObject({
        plan: "free",
        grantedByFamily: false,
      });
    }
  });

  it("通常PlanとFamily席を合成し、Family参加者にはFull相当を優先する", async () => {
    const db = createTestDb();
    const payer = await account(db, "combined-payer");
    const member = await account(db, "combined-member");
    const subscriber = await account(db, "combined-subscriber");
    const at = new Date("2026-08-16T00:00:00.000Z");
    await createFamilyPack(db, payer, at);
    await reserveFamilySeat(db, payer, "combined-invite", at);
    await activateFamilySeat(db, "combined-invite", member, at);
    const primary = new FakeAccountPlanAssignmentProvider([
      {
        accountId: member,
        plan: "lite",
        source: "subscription",
        effectiveAt: at.toISOString(),
        availableUntil: null,
        payerAccountId: member,
      },
      {
        accountId: subscriber,
        plan: "full",
        source: "subscription",
        effectiveAt: at.toISOString(),
        availableUntil: null,
        payerAccountId: subscriber,
      },
      {
        accountId: payer,
        plan: "family",
        source: "subscription",
        effectiveAt: at.toISOString(),
        availableUntil: null,
        payerAccountId: payer,
      },
    ]);
    const service = new EntitlementService(
      new FamilyAwareAccountPlanAssignmentProvider(db, primary),
    );

    await expect(service.resolve(member, at)).resolves.toMatchObject({
      plan: "family",
      source: "family-seat",
      payerAccountId: payer,
    });
    await expect(service.resolve(subscriber, at)).resolves.toMatchObject({
      plan: "full",
      source: "subscription",
      payerAccountId: subscriber,
    });
  });

  it("一方のproviderが失敗しても確認済みの有料割当を利用する", async () => {
    const db = createTestDb();
    const payer = await account(db, "failure-payer");
    const member = await account(db, "failure-member");
    const at = new Date("2026-08-16T00:00:00.000Z");
    await createFamilyPack(db, payer, at);
    await reserveFamilySeat(db, payer, "failure-invite", at);
    await activateFamilySeat(db, "failure-invite", member, at);
    const service = new EntitlementService(
      new FamilyAwareAccountPlanAssignmentProvider(db, {
        findCurrent: async (accountId) => {
          if (accountId === member) throw new Error("primary unavailable");
          return {
            accountId,
            plan: "family",
            source: "subscription",
            effectiveAt: at.toISOString(),
            availableUntil: null,
            payerAccountId: accountId,
          };
        },
      }),
    );

    await expect(service.resolve(member, at)).resolves.toMatchObject({
      plan: "family",
      resolution: "assignment",
    });
  });

  it("fake providerで反映遅延中のFamilyと期限到達後の失効を再現する", async () => {
    const provider = new FakeAccountPlanAssignmentProvider([
      {
        accountId: "delayed-member",
        plan: "family",
        source: "family-seat",
        effectiveAt: "2026-08-16T00:05:00.000Z",
        availableUntil: "2026-08-16T01:00:00.000Z",
        payerAccountId: "payer",
      },
    ]);
    const service = new EntitlementService(provider);
    await expect(
      service.resolve("delayed-member", new Date("2026-08-16T00:04:59.000Z")),
    ).resolves.toMatchObject({
      plan: "free",
      grantedByFamily: false,
    });
    await expect(
      service.resolve("delayed-member", new Date("2026-08-16T00:05:00.000Z")),
    ).resolves.toMatchObject({
      plan: "family",
    });
    await expect(
      service.resolve("delayed-member", new Date("2026-08-16T01:00:00.000Z")),
    ).resolves.toMatchObject({
      plan: "free",
      grantedByFamily: false,
    });
  });

  it("Family packが残っていても支払者の契約期限で参加者をFreeへ戻す", async () => {
    const db = createTestDb();
    const payer = await account(db, "expiring-payer");
    const member = await account(db, "expiring-member");
    const startedAt = new Date("2026-08-16T00:00:00.000Z");
    await createFamilyPack(db, payer, startedAt);
    await reserveFamilySeat(db, payer, "expiring-invite", startedAt);
    await activateFamilySeat(db, "expiring-invite", member, startedAt);
    const payerAssignments = new FakeAccountPlanAssignmentProvider([
      {
        accountId: payer,
        plan: "family",
        source: "subscription",
        effectiveAt: startedAt.toISOString(),
        availableUntil: "2026-08-16T01:00:00.000Z",
        payerAccountId: payer,
      },
    ]);
    const service = new EntitlementService(
      new FamilySeatAccountPlanAssignmentProvider(db, payerAssignments),
    );

    await expect(
      service.resolve(member, new Date("2026-08-16T00:59:59.000Z")),
    ).resolves.toMatchObject({
      plan: "family",
      availableUntil: "2026-08-16T01:00:00.000Z",
    });
    await expect(
      service.resolve(member, new Date("2026-08-16T01:00:00.000Z")),
    ).resolves.toMatchObject({ plan: "free", grantedByFamily: false });
  });
});
