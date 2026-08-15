import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import {
  chooseDailyPromptStrategy,
  listDailyPromptStrategyStats,
  markDailyPromptDelivered,
  prepareDailyPrompt,
  selectDailyPromptPreviousDayContext,
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
    followUp?: "same_day" | "next_day";
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
  it("方針実績が不足する間は標準と未観測候補を固定順序で観測する", () => {
    expect(chooseDailyPromptStrategy([], () => 0)).toBe("standard");
    expect(
      chooseDailyPromptStrategy(
        [
          {
            promptStrategy: "standard",
            deliveryOpportunityCount: 3,
            responseCount: 1,
            stopCount: 0,
          },
        ],
        () => 0,
      ),
    ).toBe("brief");
    expect(
      chooseDailyPromptStrategy(
        [
          {
            promptStrategy: "standard",
            deliveryOpportunityCount: 3,
            responseCount: 1,
            stopCount: 0,
          },
          {
            promptStrategy: "brief",
            deliveryOpportunityCount: 1,
            responseCount: 1,
            stopCount: 0,
          },
        ],
        () => 0,
      ),
    ).toBe("event_first");
  });

  it("初期観測後は停止を強く減点した本人内の最高方針を選ぶ", () => {
    const stats = [
      {
        promptStrategy: "standard" as const,
        deliveryOpportunityCount: 3,
        responseCount: 2,
        stopCount: 1,
      },
      {
        promptStrategy: "brief" as const,
        deliveryOpportunityCount: 2,
        responseCount: 2,
        stopCount: 0,
      },
      {
        promptStrategy: "event_first" as const,
        deliveryOpportunityCount: 2,
        responseCount: 1,
        stopCount: 1,
      },
      {
        promptStrategy: "feeling_first" as const,
        deliveryOpportunityCount: 2,
        responseCount: 1,
        stopCount: 0,
      },
    ];

    expect(chooseDailyPromptStrategy(stats, () => 0.5)).toBe("brief");
    const randomValues = [0.1, 0.99];
    expect(chooseDailyPromptStrategy(stats, () => randomValues.shift() ?? 0)).toBe("feeling_first");
  });

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

  it("直前の日本日付で最新のSessionが許可した翌日フォローを返す", async () => {
    const db = createTestDb();
    await insertClosedConversation(db, {
      id: "previous-day-follow-up-session",
      closedAt: new Date("2026-08-13T06:00:00.000Z"),
      followUp: "next_day",
    });

    await expect(selectDailyPromptPreviousDayContext(db, ACCOUNT_ID, "2026-08-14")).resolves.toBe(
      "next_day",
    );
  });

  it("前日の後続Sessionが翌日フォローを許可しなければ古い候補へ戻らない", async () => {
    const db = createTestDb();
    await insertClosedConversation(db, {
      id: "older-previous-day-session",
      closedAt: new Date("2026-08-13T05:00:00.000Z"),
      followUp: "next_day",
    });
    await insertClosedConversation(db, {
      id: "latest-previous-day-session",
      closedAt: new Date("2026-08-13T06:00:00.000Z"),
    });

    await expect(
      selectDailyPromptPreviousDayContext(db, ACCOUNT_ID, "2026-08-14"),
    ).resolves.toBeUndefined();
  });

  it("前日に後から始まったSessionが未終了なら古い翌日候補へ戻らない", async () => {
    const db = createTestDb();
    await insertClosedConversation(db, {
      id: "older-next-day-session",
      closedAt: new Date("2026-08-13T05:00:00.000Z"),
      followUp: "next_day",
    });
    const laterActiveSource = await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "later-active-previous-day-message",
      body: "もう少し話したい",
      receivedAt: new Date("2026-08-13T07:00:00.000Z"),
    });
    await db.insert(schema.conversationSessions).values({
      id: "later-active-previous-day-session",
      accountId: ACCOUNT_ID,
      status: "active",
      startedAt: new Date("2026-08-13T06:00:00.000Z"),
      lastUserMessageAt: new Date("2026-08-13T07:00:00.000Z"),
    });
    await db.insert(schema.conversationMessages).values({
      id: "later-active-previous-day-conversation-message",
      sessionId: "later-active-previous-day-session",
      sequence: 1,
      role: "user",
      sourceRecordId: laterActiveSource.sourceRecordId,
      channel: "line",
    });

    await expect(
      selectDailyPromptPreviousDayContext(db, ACCOUNT_ID, "2026-08-14"),
    ).resolves.toBeUndefined();
  });

  it("前日から当日へまたいだ後続Sessionがあれば古い翌日候補へ戻らない", async () => {
    const db = createTestDb();
    await insertClosedConversation(db, {
      id: "older-cross-day-next-day-session",
      closedAt: new Date("2026-08-13T05:00:00.000Z"),
      followUp: "next_day",
    });
    const previousDaySource = await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "cross-day-previous-day-message",
      body: "まだ少し話したい",
      receivedAt: new Date("2026-08-13T14:50:00.000Z"),
    });
    const currentDaySource = await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "cross-day-current-day-message",
      body: "今日はここまでにする",
      receivedAt: new Date("2026-08-13T15:05:00.000Z"),
    });
    await db.insert(schema.conversationSessions).values({
      id: "cross-day-session",
      accountId: ACCOUNT_ID,
      status: "closed",
      startedAt: new Date("2026-08-13T14:50:00.000Z"),
      lastUserMessageAt: new Date("2026-08-13T15:05:00.000Z"),
      closedAt: new Date("2026-08-13T15:06:00.000Z"),
      closeReason: "explicit",
    });
    await db.insert(schema.conversationMessages).values([
      {
        id: "cross-day-previous-day-conversation-message",
        sessionId: "cross-day-session",
        sequence: 1,
        role: "user",
        sourceRecordId: previousDaySource.sourceRecordId,
        channel: "line",
      },
      {
        id: "cross-day-current-day-conversation-message",
        sessionId: "cross-day-session",
        sequence: 2,
        role: "user",
        sourceRecordId: currentDaySource.sourceRecordId,
        channel: "line",
      },
    ]);

    await expect(
      selectDailyPromptPreviousDayContext(db, ACCOUNT_ID, "2026-08-14"),
    ).resolves.toBeUndefined();
  });

  it("2日以上前の候補や削除された本人Sourceを翌日フォローへ使わない", async () => {
    const db = createTestDb();
    await insertClosedConversation(db, {
      id: "two-days-old-session",
      closedAt: new Date("2026-08-12T06:00:00.000Z"),
      followUp: "next_day",
    });
    await expect(
      selectDailyPromptPreviousDayContext(db, ACCOUNT_ID, "2026-08-14"),
    ).resolves.toBeUndefined();

    const deletedSourceId = await insertClosedConversation(db, {
      id: "deleted-previous-day-source-session",
      closedAt: new Date("2026-08-13T06:00:00.000Z"),
      followUp: "next_day",
    });
    await db
      .update(schema.sourceRecords)
      .set({ isDeleted: true })
      .where(eq(schema.sourceRecords.id, deletedSourceId));

    await expect(
      selectDailyPromptPreviousDayContext(db, ACCOUNT_ID, "2026-08-14"),
    ).resolves.toBeUndefined();
  });

  it("複数Sourceを含むTurnの一部が削除済みなら翌日フォローを使わない", async () => {
    const db = createTestDb();
    await insertClosedConversation(db, {
      id: "partially-deleted-source-session",
      receivedAt: new Date("2026-08-13T05:58:00.000Z"),
      closedAt: new Date("2026-08-13T06:00:00.000Z"),
      followUp: "next_day",
    });
    const deletedSource = await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "partially-deleted-next-day-intent",
      body: "明日また話したい",
      receivedAt: new Date("2026-08-13T05:59:00.000Z"),
    });
    await db.insert(schema.conversationMessages).values({
      id: "message-partially-deleted-next-day-intent",
      sessionId: "partially-deleted-source-session",
      sequence: 2,
      role: "user",
      sourceRecordId: deletedSource.sourceRecordId,
      channel: "line",
    });
    await db
      .update(schema.conversationSessions)
      .set({ lastUserMessageAt: new Date("2026-08-13T05:59:00.000Z") })
      .where(eq(schema.conversationSessions.id, "partially-deleted-source-session"));
    await db
      .update(schema.chatTurns)
      .set({ throughSequence: 2 })
      .where(eq(schema.chatTurns.id, "turn-partially-deleted-source-session"));
    await db
      .update(schema.sourceRecords)
      .set({ isDeleted: true })
      .where(eq(schema.sourceRecords.id, deletedSource.sourceRecordId));

    await expect(
      selectDailyPromptPreviousDayContext(db, ACCOUNT_ID, "2026-08-14"),
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
        promptStrategy: "brief",
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
        promptStrategy: "feeling_first",
        at: new Date(at.getTime() + 30_000),
      }),
    ).resolves.toMatchObject({
      type: "ready",
      promptVersion: "daily-check-in-fri-v1",
    });
    expect(
      await db
        .select({
          promptVersion: schema.dailyPromptDeliveries.promptVersion,
          promptStrategy: schema.dailyPromptDeliveries.promptStrategy,
        })
        .from(schema.dailyPromptDeliveries)
        .get(),
    ).toEqual({ promptVersion: "daily-check-in-fri-v1", promptStrategy: "brief" });
  });

  it("本人発言を直前の未回答配送1件だけへ対応づけ、方針別に集計する", async () => {
    const db = createTestDb();
    const firstAt = new Date("2026-08-10T09:00:00.000Z");
    const secondAt = new Date("2026-08-12T09:00:00.000Z");
    await db.insert(schema.dailyPromptDeliveries).values([
      {
        id: "daily-prompt:2026-08-10",
        accountId: ACCOUNT_ID,
        localDate: "2026-08-10",
        promptVersion: "daily-check-in-mon-v1:brief-v1",
        promptStrategy: "brief",
        status: "delivered",
        deliveredAt: firstAt,
        createdAt: firstAt,
        updatedAt: firstAt,
      },
      {
        id: "daily-prompt:2026-08-12",
        accountId: ACCOUNT_ID,
        localDate: "2026-08-12",
        promptVersion: "daily-check-in-wed-v1:event_first-v1",
        promptStrategy: "event_first",
        status: "delivered",
        deliveredAt: secondAt,
        createdAt: secondAt,
        updatedAt: secondAt,
      },
    ]);

    await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "strategy-response",
      body: "今日は仕事が進んだ",
      receivedAt: new Date("2026-08-12T10:00:00.000Z"),
    });

    expect(
      await db
        .select({
          localDate: schema.dailyPromptDeliveries.localDate,
          responseKind: schema.dailyPromptDeliveries.responseKind,
        })
        .from(schema.dailyPromptDeliveries)
        .orderBy(schema.dailyPromptDeliveries.localDate),
    ).toEqual([
      { localDate: "2026-08-10", responseKind: null },
      { localDate: "2026-08-12", responseKind: "reply" },
    ]);
    await expect(listDailyPromptStrategyStats(db, ACCOUNT_ID)).resolves.toEqual([
      {
        promptStrategy: "brief",
        deliveryOpportunityCount: 1,
        responseCount: 0,
        stopCount: 0,
      },
      {
        promptStrategy: "event_first",
        deliveryOpportunityCount: 1,
        responseCount: 1,
        stopCount: 0,
      },
    ]);
  });

  it("停止発言を通常返信と分けて集計する", async () => {
    const db = createTestDb();
    const at = new Date("2026-08-14T09:00:00.000Z");
    await db.insert(schema.dailyPromptDeliveries).values({
      id: "daily-prompt:2026-08-14",
      accountId: ACCOUNT_ID,
      localDate: "2026-08-14",
      promptVersion: "daily-check-in-fri-v1",
      promptStrategy: "standard",
      status: "delivered",
      deliveredAt: at,
      createdAt: at,
      updatedAt: at,
    });

    await storeLineTextSource(db, {
      accountId: ACCOUNT_ID,
      eventId: "strategy-stop",
      body: "メッセージを止めて",
      receivedAt: new Date("2026-08-14T10:00:00.000Z"),
      dailyPromptControl: "stop",
    });

    await expect(listDailyPromptStrategyStats(db, ACCOUNT_ID)).resolves.toEqual([
      {
        promptStrategy: "standard",
        deliveryOpportunityCount: 1,
        responseCount: 0,
        stopCount: 1,
      },
    ]);
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
