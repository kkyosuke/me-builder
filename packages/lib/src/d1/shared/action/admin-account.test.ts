import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import {
  InvalidAdminAccountCursorError,
  createAdminAccountReference,
  listAdminAccounts,
  recordAdminAccountListAudit,
  upsertAccountProgressionProjection,
} from "./admin-account";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });

  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      let results: unknown[] = [];
      sqlite.transaction(() => {
        results = queries.map((query) => (query as { run: () => unknown }).run());
      })();
      return results;
    },
    writable: true,
  });

  return db as unknown as SharedD1Client;
}

async function insertAccount(
  db: SharedD1Client,
  input: Readonly<{
    id: string;
    createdAt: Date;
    role?: "user" | "admin";
  }>,
): Promise<void> {
  await db.insert(schema.accounts).values({
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    role: input.role ?? "user",
  });
}

const emptyProgression = {
  level: 1,
  growthValue: 0,
  currentLevelThreshold: 0,
  nextLevelThreshold: 5,
  collectedPieces: 0,
  activePieces: 0,
  categoryCount: 0,
  calculationVersion: 1,
  highestLevel: 1,
  isProcessing: false,
  recentChanges: [],
  milestoneCards: [],
};

describe("Admin Account progression projection", () => {
  it("成長時だけ最終成長日時を更新し、active数だけの減少では維持する", async () => {
    const db = createTestDb();
    await insertAccount(db, {
      id: "account-1",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    const firstGrowthAt = new Date("2026-08-02T00:00:00.000Z");
    await upsertAccountProgressionProjection(
      db,
      "account-1",
      { ...emptyProgression, level: 2, growthValue: 7, collectedPieces: 2, activePieces: 2 },
      firstGrowthAt,
    );
    await upsertAccountProgressionProjection(
      db,
      "account-1",
      { ...emptyProgression, level: 2, growthValue: 7, collectedPieces: 2, activePieces: 1 },
      new Date("2026-08-03T00:00:00.000Z"),
    );

    expect(await db.select().from(schema.accountProgressionProjections).get()).toMatchObject({
      level: 2,
      activePieces: 1,
      lastGrowthAt: firstGrowthAt,
      projectedAt: new Date("2026-08-03T00:00:00.000Z"),
    });
  });
});

describe("Admin Account list", () => {
  it("projection未作成を残し、仮名管理参照の完全一致とroleで検索する", async () => {
    const db = createTestDb();
    await insertAccount(db, {
      id: "account-user",
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
    });
    await insertAccount(db, {
      id: "account-admin",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      role: "admin",
    });
    await upsertAccountProgressionProjection(db, "account-user", {
      ...emptyProgression,
      level: 2,
      growthValue: 7,
      collectedPieces: 2,
      activePieces: 2,
    });

    const userReference = await createAdminAccountReference("account-user");
    await expect(listAdminAccounts(db, { query: userReference })).resolves.toMatchObject({
      total: 1,
      accounts: [
        {
          adminReference: userReference,
          plan: "free",
          progression: { status: "ready", level: 2 },
        },
      ],
    });
    await expect(listAdminAccounts(db, { role: "admin" })).resolves.toMatchObject({
      total: 1,
      accounts: [{ progression: { status: "pending" } }],
    });
  });

  it("指定順を保ったcursorで重複なく次ページを返す", async () => {
    const db = createTestDb();
    for (const [index, level] of [2, 4, 3].entries()) {
      const accountId = `account-${index + 1}`;
      await insertAccount(db, {
        id: accountId,
        createdAt: new Date(`2026-08-0${index + 1}T00:00:00.000Z`),
      });
      await upsertAccountProgressionProjection(db, accountId, {
        ...emptyProgression,
        level,
        growthValue: 5 * (level - 1) ** 2,
      });
    }

    const first = await listAdminAccounts(db, { sort: "level", limit: 2 });
    expect(first.accounts.map(({ adminReference }) => adminReference)).toEqual([
      await createAdminAccountReference("account-2"),
      await createAdminAccountReference("account-3"),
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listAdminAccounts(db, {
      sort: "level",
      limit: 2,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    expect(second.accounts.map(({ adminReference }) => adminReference)).toEqual([
      await createAdminAccountReference("account-1"),
    ]);
  });

  it("有効期間内の課金projectionだけを現在Planとして返す", async () => {
    const db = createTestDb();
    const createdAt = new Date("2026-08-01T00:00:00.000Z");
    await insertAccount(db, { id: "active-plan", createdAt });
    await insertAccount(db, { id: "expired-plan", createdAt });
    for (const [accountId, periodStart, periodEnd] of [
      ["active-plan", new Date("2099-08-01T00:00:00.000Z"), new Date("2099-09-01T00:00:00.000Z")],
      ["expired-plan", new Date("2020-08-01T00:00:00.000Z"), new Date("2020-09-01T00:00:00.000Z")],
    ] as const) {
      await db.insert(schema.billingCustomers).values({
        accountId,
        providerCustomerId: `customer-${accountId}`,
        createdAt,
        updatedAt: createdAt,
      });
      await db.insert(schema.billingSubscriptionProjections).values({
        providerSubscriptionId: `subscription-${accountId}`,
        accountId,
        providerCustomerId: `customer-${accountId}`,
        status: "active",
        planCode: "full",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        providerCreatedAt: createdAt,
        lastEventCreatedAt: createdAt,
        lastSyncedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });
    }

    const page = await listAdminAccounts(db);
    const activeReference = await createAdminAccountReference("active-plan");
    const expiredReference = await createAdminAccountReference("expired-plan");
    expect(page.accounts.find((account) => account.adminReference === activeReference)?.plan).toBe(
      "full",
    );
    expect(page.accounts.find((account) => account.adminReference === expiredReference)?.plan).toBe(
      "free",
    );
  });

  it("過大なcursorをDBへ渡す前に拒否する", async () => {
    const db = createTestDb();

    await expect(listAdminAccounts(db, { cursor: "a".repeat(513) })).rejects.toBeInstanceOf(
      InvalidAdminAccountCursorError,
    );
  });
});

describe("Admin Account list audit", () => {
  it("非機密な操作情報だけを保存し、1年を過ぎた記録を削除する", async () => {
    const db = createTestDb();
    const old = new Date("2025-08-19T00:00:00.000Z");
    const current = new Date("2026-08-20T00:00:00.000Z");
    const input = {
      adminReference: await createAdminAccountReference("admin-account"),
      queryPresent: true,
      role: "all" as const,
      status: "active" as const,
      sort: "created" as const,
      resultCount: 1,
      total: 1,
    };
    await recordAdminAccountListAudit(db, input, old);
    await recordAdminAccountListAudit(db, input, current);

    expect(db.select().from(schema.adminAccountListAudits).all()).toEqual([
      expect.objectContaining({
        adminReference: input.adminReference,
        queryPresent: true,
        roleFilter: "all",
        statusFilter: "active",
        createdAt: current,
      }),
    ]);
  });
});
