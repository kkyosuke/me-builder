import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import {
  InvalidAdminAccountCursorError,
  listAdminAccounts,
  upsertAccountProgressionProjection,
} from "./admin-account";
import { saveVerifiedDisplayName } from "./profile";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
  return db as unknown as SharedD1Client;
}

async function insertAccount(
  db: SharedD1Client,
  input: Readonly<{
    id: string;
    createdAt: Date;
    role?: "user" | "admin";
    displayName?: string;
  }>,
): Promise<void> {
  await db.insert(schema.accounts).values({
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    role: input.role ?? "user",
  });
  if (input.displayName) {
    await saveVerifiedDisplayName(db, input.id, input.displayName, input.createdAt);
  }
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
  it("projection未作成を残し、名前・roleで検索する", async () => {
    const db = createTestDb();
    await insertAccount(db, {
      id: "account-user",
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
      displayName: "山田 花子",
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

    await expect(listAdminAccounts(db, { query: "山田" })).resolves.toMatchObject({
      total: 1,
      accounts: [
        {
          id: "account-user",
          displayName: "山田 花子",
          progression: { status: "ready", level: 2 },
        },
      ],
    });
    await expect(listAdminAccounts(db, { role: "admin" })).resolves.toMatchObject({
      total: 1,
      accounts: [{ id: "account-admin", progression: { status: "pending" } }],
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
    expect(first.accounts.map(({ id }) => id)).toEqual(["account-2", "account-3"]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listAdminAccounts(db, {
      sort: "level",
      limit: 2,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    expect(second.accounts.map(({ id }) => id)).toEqual(["account-1"]);
  });

  it("過大なcursorをDBへ渡す前に拒否する", async () => {
    const db = createTestDb();

    await expect(listAdminAccounts(db, { cursor: "a".repeat(513) })).rejects.toBeInstanceOf(
      InvalidAdminAccountCursorError,
    );
  });
});
