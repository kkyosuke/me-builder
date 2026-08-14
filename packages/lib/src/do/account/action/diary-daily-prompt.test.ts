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

  it("Queue再配送までにSessionが始まった場合はpendingをskipへ終端化する", async () => {
    const db = createTestDb();
    const at = new Date("2026-08-14T09:00:00.000Z");
    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-08-14",
        promptVersion: PROMPT_VERSION,
        at,
      }),
    ).resolves.toMatchObject({ type: "ready" });
    await db.insert(schema.conversationSessions).values({
      id: "active-after-first-attempt",
      accountId: ACCOUNT_ID,
      status: "active",
      startedAt: new Date(at.getTime() + 30_000),
      lastUserMessageAt: new Date(at.getTime() + 30_000),
    });

    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-08-14",
        promptVersion: PROMPT_VERSION,
        at: new Date(at.getTime() + 60_000),
      }),
    ).resolves.toEqual({
      type: "not-ready",
      status: "skipped",
      reason: "active_session",
    });
    expect(
      await db
        .select({ status: schema.dailyPromptDeliveries.status })
        .from(schema.dailyPromptDeliveries)
        .get(),
    ).toEqual({ status: "skipped" });
  });

  it("Queue再配送までに本人の発言があれば当日のpendingを送らない", async () => {
    const db = createTestDb();
    const at = new Date("2026-08-14T09:00:00.000Z");
    await prepareDailyPrompt(db, ACCOUNT_ID, {
      localDate: "2026-08-14",
      promptVersion: PROMPT_VERSION,
      at,
    });
    await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "daytime-message",
      body: "今日は忙しかった",
      receivedAt: new Date(at.getTime() + 30_000),
    });

    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-08-14",
        promptVersion: PROMPT_VERSION,
        at: new Date(at.getTime() + 60_000),
      }),
    ).resolves.toEqual({
      type: "not-ready",
      status: "skipped",
      reason: "user_activity",
    });
  });

  it("配送日を過ぎたQueueメッセージはstaleとして送らない", async () => {
    const db = createTestDb();

    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-08-14",
        promptVersion: PROMPT_VERSION,
        at: new Date("2026-08-15T09:00:00.000Z"),
      }),
    ).resolves.toEqual({ type: "not-ready", status: "skipped", reason: "stale" });
  });

  it("明示的な停止発言を根拠付きで保持し、翌日以降を送らない", async () => {
    const db = createTestDb();
    await prepareDailyPrompt(db, ACCOUNT_ID, {
      localDate: "2026-08-14",
      promptVersion: PROMPT_VERSION,
      at: new Date("2026-08-14T09:00:00.000Z"),
    });
    const source = await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "stop-message",
      body: "毎日の声かけを停止してください",
      receivedAt: new Date("2026-08-14T10:00:00.000Z"),
      dailyPromptControl: "stop",
    });

    expect(await db.select().from(schema.dailyPromptPreferences).get()).toMatchObject({
      accountId: ACCOUNT_ID,
      status: "stopped",
      controlSourceRecordId: source.sourceRecordId,
    });
    expect(await db.select().from(schema.dailyPromptDeliveries).get()).toMatchObject({
      status: "skipped",
      skipReason: "manual_stopped",
    });
    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-08-15",
        promptVersion: PROMPT_VERSION,
        at: new Date("2026-08-15T09:00:00.000Z"),
      }),
    ).resolves.toEqual({
      type: "not-ready",
      status: "skipped",
      reason: "manual_stopped",
    });
  });

  it("明示的な再開発言を根拠付きで保持し、終端済みの当日分は再送せず翌日から再開する", async () => {
    const db = createTestDb();
    await prepareDailyPrompt(db, ACCOUNT_ID, {
      localDate: "2026-08-14",
      promptVersion: PROMPT_VERSION,
      at: new Date("2026-08-14T09:00:00.000Z"),
    });
    await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "stop-message",
      body: "毎日の声かけを停止してください",
      receivedAt: new Date("2026-08-14T10:00:00.000Z"),
      dailyPromptControl: "stop",
    });
    const resumed = await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "resume-message",
      body: "毎日の声かけを再開してください",
      receivedAt: new Date("2026-08-14T11:00:00.000Z"),
      dailyPromptControl: "resume",
    });

    expect(await db.select().from(schema.dailyPromptPreferences).get()).toMatchObject({
      accountId: ACCOUNT_ID,
      status: "active",
      controlledAt: new Date("2026-08-14T11:00:00.000Z"),
      controlSourceRecordId: resumed.sourceRecordId,
    });
    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-08-14",
        promptVersion: PROMPT_VERSION,
        at: new Date("2026-08-14T12:00:00.000Z"),
      }),
    ).resolves.toEqual({
      type: "not-ready",
      status: "skipped",
      reason: "manual_stopped",
    });
    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-08-15",
        promptVersion: PROMPT_VERSION,
        at: new Date("2026-08-15T09:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ type: "ready" });
  });

  it("再開後に古い停止Webhookが再配送・遅延到着しても停止状態へ戻さない", async () => {
    const db = createTestDb();
    const stopInput = {
      accountId: ACCOUNT_ID,
      eventId: "old-stop-message",
      body: "毎日の声かけを停止してください",
      receivedAt: new Date("2026-08-14T10:00:00.000Z"),
      dailyPromptControl: "stop" as const,
    };
    await storeLineTextSource(db, stopInput);
    const resumed = await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "new-resume-message",
      body: "毎日の声かけを再開してください",
      receivedAt: new Date("2026-08-14T11:00:00.000Z"),
      dailyPromptControl: "resume",
    });
    const nextDay = await prepareDailyPrompt(db, ACCOUNT_ID, {
      localDate: "2026-08-15",
      promptVersion: PROMPT_VERSION,
      at: new Date("2026-08-15T09:00:00.000Z"),
    });
    expect(nextDay.type).toBe("ready");

    await storeLineTextSource(db, stopInput);
    await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "delayed-stop-message",
      body: "声かけを止めて",
      receivedAt: new Date("2026-08-14T10:30:00.000Z"),
      dailyPromptControl: "stop",
    });

    expect(await db.select().from(schema.dailyPromptPreferences).get()).toMatchObject({
      status: "active",
      controlledAt: new Date("2026-08-14T11:00:00.000Z"),
      controlSourceRecordId: resumed.sourceRecordId,
    });
    expect(
      await db
        .select({ status: schema.dailyPromptDeliveries.status })
        .from(schema.dailyPromptDeliveries)
        .where(eq(schema.dailyPromptDeliveries.localDate, "2026-08-15"))
        .get(),
    ).toEqual({ status: "pending" });
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
