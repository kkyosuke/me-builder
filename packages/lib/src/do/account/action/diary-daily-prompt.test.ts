import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import { markDailyPromptDelivered, prepareDailyPrompt, storeLineTextSource } from "./diary";

const ACCOUNT_ID = "account-1";
const PROMPT_VERSION = "daily-check-in-v1";

function createTestDb(): AccountDataDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  Object.assign(db, {
    batch: async (queries: readonly PromiseLike<unknown>[]) => {
      const results = [];
      for (const query of queries) results.push(await query);
      return results;
    },
  });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle-do-account") });
  db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: ACCOUNT_ID }).run();
  return db as unknown as AccountDataDatabase;
}

describe("daily prompt delivery", () => {
  it("同じ日本日付を1回だけ準備し、配送済みを再送対象にしない", async () => {
    const db = createTestDb();
    const at = new Date("2026-08-14T09:00:00.000Z");

    const first = await prepareDailyPrompt(db, ACCOUNT_ID, {
      localDate: "2026-08-14",
      promptVersion: PROMPT_VERSION,
      at,
    });
    expect(first).toEqual({
      type: "ready",
      deliveryId: "daily-prompt:2026-08-14",
      promptVersion: PROMPT_VERSION,
    });
    if (first.type !== "ready") throw new Error("Daily prompt was not prepared");
    await expect(markDailyPromptDelivered(db, ACCOUNT_ID, first.deliveryId, at)).resolves.toBe(
      true,
    );

    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-08-14",
        promptVersion: PROMPT_VERSION,
        at,
      }),
    ).resolves.toEqual({ type: "not-ready", status: "delivered" });
  });

  it("active Sessionがあれば当日の声かけをskipする", async () => {
    const db = createTestDb();
    const at = new Date("2026-08-14T09:00:00.000Z");
    await db.insert(schema.conversationSessions).values({
      id: "active-session",
      accountId: ACCOUNT_ID,
      status: "active",
      startedAt: new Date(at.getTime() - 60 * 60 * 1000),
      lastUserMessageAt: new Date(at.getTime() - 60 * 60 * 1000),
    });

    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-08-14",
        promptVersion: PROMPT_VERSION,
        at,
      }),
    ).resolves.toEqual({
      type: "not-ready",
      status: "skipped",
      reason: "active_session",
    });
  });

  it("未回答の翌日を休み、3回未回答なら本人の新着まで自動休止する", async () => {
    const db = createTestDb();
    for (const localDate of ["2026-08-10", "2026-08-12", "2026-08-14"]) {
      const prepared = await prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate,
        promptVersion: PROMPT_VERSION,
        at: new Date(`${localDate}T09:00:00.000Z`),
      });
      expect(prepared.type).toBe("ready");
      if (prepared.type !== "ready") throw new Error("Daily prompt was not prepared");
      await markDailyPromptDelivered(
        db,
        ACCOUNT_ID,
        prepared.deliveryId,
        new Date(`${localDate}T09:00:00.000Z`),
      );
      const nextDate = new Date(`${localDate}T00:00:00.000Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      await expect(
        prepareDailyPrompt(db, ACCOUNT_ID, {
          localDate: nextDate.toISOString().slice(0, 10),
          promptVersion: PROMPT_VERSION,
          at: new Date(nextDate.getTime() + 9 * 60 * 60 * 1000),
        }),
      ).resolves.toMatchObject({ type: "not-ready", status: "skipped" });
    }

    const paused = await db
      .select()
      .from(schema.dailyPromptDeliveries)
      .where(eq(schema.dailyPromptDeliveries.localDate, "2026-08-15"))
      .get();
    expect(paused?.skipReason).toBe("auto_paused");

    await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "user-returned",
      body: "今日は話したい",
      receivedAt: new Date("2026-08-15T12:00:00.000Z"),
    });
    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-08-16",
        promptVersion: PROMPT_VERSION,
        at: new Date("2026-08-16T09:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ type: "ready" });
  });

  it("不正な日本日付を拒否する", async () => {
    const db = createTestDb();
    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-02-30",
        promptVersion: PROMPT_VERSION,
      }),
    ).rejects.toThrow("date is invalid");
  });
});
