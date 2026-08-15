import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import {
  markDailyPromptDelivered,
  prepareDailyPrompt,
  selectDailyPromptSameDayContext,
  storeLineTextSource,
} from "./diary";

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

async function insertClosedConversation(
  db: AccountDataDatabase,
  input: Readonly<{
    id: string;
    closedAt: Date;
    receivedAt?: Date;
    followUp?: "same_day";
    closeReason?: "explicit" | "inactive";
  }>,
): Promise<string> {
  const receivedAt = input.receivedAt ?? new Date(input.closedAt.getTime() - 60_000);
  const source = await storeLineTextSource(db, {
    accountId: ACCOUNT_ID,
    eventId: `event-${input.id}`,
    body: "あとで続きを話したい",
    receivedAt,
  });
  await db.insert(schema.conversationSessions).values({
    id: input.id,
    accountId: ACCOUNT_ID,
    status: "closed",
    startedAt: new Date(input.closedAt.getTime() - 120_000),
    lastUserMessageAt: receivedAt,
    closedAt: input.closedAt,
    closeReason: input.closeReason ?? "explicit",
  });
  await db.insert(schema.conversationMessages).values({
    id: `message-${input.id}`,
    sessionId: input.id,
    sequence: 1,
    role: "user",
    sourceRecordId: source.sourceRecordId,
    channel: "line",
  });
  await db.insert(schema.chatTurns).values({
    id: `turn-${input.id}`,
    sessionId: input.id,
    fromSequence: 1,
    throughSequence: 1,
    generationEpoch: 1,
    status: "delivered",
    promptVersion: "diary-chat-v13",
    model: "test-model",
    endSession: true,
    dailyPromptFollowUp: input.followUp,
    receivedAt,
  });
  return source.sourceRecordId;
}

describe("daily prompt delivery", () => {
  it("配送日の最新の終了済みSessionが許可した同日フォローだけを返す", async () => {
    const db = createTestDb();
    await insertClosedConversation(db, {
      id: "same-day-session",
      closedAt: new Date("2026-08-14T06:00:00.000Z"),
      followUp: "same_day",
    });

    await expect(
      selectDailyPromptSameDayContext(
        db,
        ACCOUNT_ID,
        "2026-08-14",
        new Date("2026-08-14T09:00:00.000Z"),
      ),
    ).resolves.toBe("same_day");
  });

  it("後から閉じたSessionが同日フォローを許可しなければ古い候補へ戻らない", async () => {
    const db = createTestDb();
    await insertClosedConversation(db, {
      id: "older-session",
      closedAt: new Date("2026-08-14T05:00:00.000Z"),
      followUp: "same_day",
    });
    await insertClosedConversation(db, {
      id: "latest-session",
      closedAt: new Date("2026-08-14T06:00:00.000Z"),
    });

    await expect(
      selectDailyPromptSameDayContext(
        db,
        ACCOUNT_ID,
        "2026-08-14",
        new Date("2026-08-14T09:00:00.000Z"),
      ),
    ).resolves.toBeUndefined();
  });

  it("期限切れの新しいSessionを閉じてから候補を選び、古い候補へ戻らない", async () => {
    const db = createTestDb();
    await insertClosedConversation(db, {
      id: "older-follow-up-session",
      closedAt: new Date("2026-08-14T00:00:00.000Z"),
      followUp: "same_day",
    });
    await db.insert(schema.conversationSessions).values({
      id: "newer-expired-session",
      accountId: ACCOUNT_ID,
      status: "active",
      startedAt: new Date("2026-08-14T01:00:00.000Z"),
      lastUserMessageAt: new Date("2026-08-14T02:00:00.000Z"),
    });

    await expect(
      selectDailyPromptSameDayContext(
        db,
        ACCOUNT_ID,
        "2026-08-14",
        new Date("2026-08-14T09:00:00.000Z"),
      ),
    ).resolves.toBeUndefined();
    expect(
      db
        .select({
          status: schema.conversationSessions.status,
          closeReason: schema.conversationSessions.closeReason,
        })
        .from(schema.conversationSessions)
        .where(eq(schema.conversationSessions.id, "newer-expired-session"))
        .get(),
    ).toEqual({ status: "closed", closeReason: "inactive" });
  });

  it("18時より後に閉じたSessionを日中文脈へ含めない", async () => {
    const db = createTestDb();
    await insertClosedConversation(db, {
      id: "after-cutoff-session",
      receivedAt: new Date("2026-08-14T09:04:00.000Z"),
      closedAt: new Date("2026-08-14T09:05:00.000Z"),
      followUp: "same_day",
    });

    await expect(
      selectDailyPromptSameDayContext(
        db,
        ACCOUNT_ID,
        "2026-08-14",
        new Date("2026-08-14T09:00:00.000Z"),
      ),
    ).resolves.toBeUndefined();
  });

  it("明示終了でないSessionや削除された本人Sourceを同日フォローへ使わない", async () => {
    const db = createTestDb();
    await insertClosedConversation(db, {
      id: "inactive-session",
      closedAt: new Date("2026-08-14T05:00:00.000Z"),
      followUp: "same_day",
      closeReason: "inactive",
    });
    await expect(
      selectDailyPromptSameDayContext(
        db,
        ACCOUNT_ID,
        "2026-08-14",
        new Date("2026-08-14T09:00:00.000Z"),
      ),
    ).resolves.toBeUndefined();

    const deletedSourceId = await insertClosedConversation(db, {
      id: "deleted-source-session",
      closedAt: new Date("2026-08-14T06:00:00.000Z"),
      followUp: "same_day",
    });
    await db
      .update(schema.sourceRecords)
      .set({ isDeleted: true })
      .where(eq(schema.sourceRecords.id, deletedSourceId));

    await expect(
      selectDailyPromptSameDayContext(
        db,
        ACCOUNT_ID,
        "2026-08-14",
        new Date("2026-08-14T09:00:00.000Z"),
      ),
    ).resolves.toBeUndefined();
  });

  it("前日に受け取った発言を当日の日中文脈として扱わない", async () => {
    const db = createTestDb();
    await insertClosedConversation(db, {
      id: "previous-day-source-session",
      receivedAt: new Date("2026-08-13T14:59:00.000Z"),
      closedAt: new Date("2026-08-13T15:01:00.000Z"),
      followUp: "same_day",
    });

    await expect(
      selectDailyPromptSameDayContext(
        db,
        ACCOUNT_ID,
        "2026-08-14",
        new Date("2026-08-14T09:00:00.000Z"),
      ),
    ).resolves.toBeUndefined();
  });

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

  it("pending配送は再準備時に新しい文面versionへ差し替えない", async () => {
    const db = createTestDb();
    const at = new Date("2026-08-14T09:00:00.000Z");
    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-08-14",
        promptVersion: "daily-check-in-fri-v1",
        at,
      }),
    ).resolves.toMatchObject({
      type: "ready",
      promptVersion: "daily-check-in-fri-v1",
    });

    await expect(
      prepareDailyPrompt(db, ACCOUNT_ID, {
        localDate: "2026-08-14",
        promptVersion: "daily-check-in-fri-v2",
        at: new Date(at.getTime() + 30_000),
      }),
    ).resolves.toMatchObject({
      type: "ready",
      promptVersion: "daily-check-in-fri-v1",
    });
    expect(
      await db
        .select({ promptVersion: schema.dailyPromptDeliveries.promptVersion })
        .from(schema.dailyPromptDeliveries)
        .get(),
    ).toEqual({ promptVersion: "daily-check-in-fri-v1" });
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

  it("停止後の通常メッセージで再開し、終端済みの当日分は再送せず翌日から送る", async () => {
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
    const resumedByMessage = await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "ordinary-message",
      body: "今日は仕事が大変だった",
      receivedAt: new Date("2026-08-14T11:00:00.000Z"),
    });

    expect(await db.select().from(schema.dailyPromptPreferences).get()).toMatchObject({
      accountId: ACCOUNT_ID,
      status: "active",
      controlledAt: new Date("2026-08-14T11:00:00.000Z"),
      controlSourceRecordId: resumedByMessage.sourceRecordId,
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

  it("通常メッセージでの再開後に古い停止Webhookが届いても停止状態へ戻さない", async () => {
    const db = createTestDb();
    const stopInput = {
      accountId: ACCOUNT_ID,
      eventId: "old-stop-message",
      body: "毎日の声かけを停止してください",
      receivedAt: new Date("2026-08-14T10:00:00.000Z"),
      dailyPromptControl: "stop" as const,
    };
    await storeLineTextSource(db, stopInput);
    const resumedByMessage = await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "new-ordinary-message",
      body: "今日は仕事が大変だった",
      receivedAt: new Date("2026-08-14T11:00:00.000Z"),
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
      controlSourceRecordId: resumedByMessage.sourceRecordId,
    });
    expect(
      await db
        .select({ status: schema.dailyPromptDeliveries.status })
        .from(schema.dailyPromptDeliveries)
        .where(eq(schema.dailyPromptDeliveries.localDate, "2026-08-15"))
        .get(),
    ).toEqual({ status: "pending" });
  });

  it("停止と次のメッセージが同じ秒でもミリ秒順で再開する", async () => {
    const db = createTestDb();
    await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "same-second-stop",
      body: "声かけを止めて",
      receivedAt: new Date("2026-08-14T10:00:00.100Z"),
      dailyPromptControl: "stop",
    });
    const resumedByMessage = await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "same-second-message",
      body: "今日は仕事が大変だった",
      receivedAt: new Date("2026-08-14T10:00:00.900Z"),
    });

    expect(await db.select().from(schema.dailyPromptPreferences).get()).toMatchObject({
      status: "active",
      controlledAt: new Date("2026-08-14T10:00:00.900Z"),
      controlSourceRecordId: resumedByMessage.sourceRecordId,
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
