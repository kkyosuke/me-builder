import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { D1Client } from "../client";
import * as schema from "../schema";
import { findLineIdentityByAccountId, upsertIdentity } from "./account";
import {
  attachMessagesToTurn,
  closeTurnSession,
  getPendingAssistantResponse,
  getTurnContext,
  markTurnDelivered,
  markTurnFailed,
  markTurnGenerating,
  saveAssistantResponse,
  storeLineTextSource,
} from "./conversation";

function createTestDb(): D1Client {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: D1用migrationをSQLite integration testへ適用する
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      const results = [];
      for (const query of queries) results.push(await query);
      return results;
    },
    writable: true,
  });
  return db as unknown as D1Client;
}

describe("Diary conversation persistence flow", () => {
  it("LINE原本の保存からTurn配送完了とSession終了まで冪等に処理する", async () => {
    const db = createTestDb();
    const { account } = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "U_diary_e2e",
    });
    const firstReceivedAt = new Date("2026-08-07T00:00:00.000Z");
    const secondReceivedAt = new Date("2026-08-07T00:00:01.000Z");
    const first = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "event-1",
      body: "今日は少し疲れた",
      receivedAt: firstReceivedAt,
    });
    const second = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "event-2",
      body: "それでも散歩できた",
      receivedAt: secondReceivedAt,
    });

    await expect(
      storeLineTextSource(db, {
        accountId: account.id,
        eventId: "event-1",
        body: "再配送で書き換えられてはいけない本文",
        receivedAt: firstReceivedAt,
      }),
    ).resolves.toEqual(first);
    const attached = await attachMessagesToTurn(db, [second, first], 1, "test-model");
    await expect(attachMessagesToTurn(db, [first, second], 1, "test-model")).resolves.toEqual(
      attached,
    );

    const context = await getTurnContext(db, attached.turnId, 20);
    expect(context).toMatchObject({
      accountId: account.id,
      messages: [
        { role: "user", body: "今日は少し疲れた", sequence: 1 },
        { role: "user", body: "それでも散歩できた", sequence: 2 },
      ],
    });
    expect(context?.currentUserMessageIds).toEqual(context?.messages.map(({ id }) => id));
    await expect(findLineIdentityByAccountId(db, account.id)).resolves.toBe("U_diary_e2e");

    await expect(markTurnGenerating(db, attached.turnId)).resolves.toBe(true);
    const responseMessageId = await saveAssistantResponse(db, {
      turnId: attached.turnId,
      body: "疲れている中でも散歩できたんだね。今は少し休めそう？",
      endSession: true,
    });
    await expect(
      saveAssistantResponse(db, {
        turnId: attached.turnId,
        body: "再試行で重複保存されてはいけない応答",
        endSession: true,
      }),
    ).resolves.toBe(responseMessageId);
    await expect(
      getPendingAssistantResponse(db, { accountId: account.id, turnId: attached.turnId }),
    ).resolves.toEqual({
      body: "疲れている中でも散歩できたんだね。今は少し休めそう？",
      endSession: true,
    });
    const { account: anotherAccount } = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "U_another_diary_user",
    });
    await expect(
      getPendingAssistantResponse(db, {
        accountId: anotherAccount.id,
        turnId: attached.turnId,
      }),
    ).resolves.toBeUndefined();

    await expect(markTurnDelivered(db, attached.turnId)).resolves.toBe(true);
    await expect(markTurnFailed(db, attached.turnId, "stale_delivery_failure")).resolves.toBe(
      false,
    );
    await expect(markTurnGenerating(db, attached.turnId)).resolves.toBe(false);
    await closeTurnSession(db, attached.turnId);

    const storedTurn = await db
      .select()
      .from(schema.chatTurns)
      .where(eq(schema.chatTurns.id, attached.turnId))
      .get();
    expect(storedTurn).toMatchObject({ status: "delivered", responseMessageId });
    const storedSession = await db
      .select()
      .from(schema.conversationSessions)
      .where(eq(schema.conversationSessions.id, attached.sessionId))
      .get();
    expect(storedSession).toMatchObject({
      status: "closed",
      closeReason: "explicit",
      nextSequence: 4,
    });
    expect(await db.select().from(schema.conversationMessages)).toHaveLength(3);
    expect(await db.select().from(schema.sourceRecordTextPayloads)).toMatchObject([
      { body: "今日は少し疲れた" },
      { body: "それでも散歩できた" },
    ]);
  });

  it("異なるSessionへ保存済みのeventを同じTurnとして再attachしない", async () => {
    const db = createTestDb();
    const { account } = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "U_session_boundary",
    });
    const first = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "old-session-event",
      body: "ここで一度終わります",
      receivedAt: new Date("2026-08-07T00:00:00.000Z"),
    });
    const firstTurn = await attachMessagesToTurn(db, [first], 1, "test-model");
    await closeTurnSession(db, firstTurn.turnId);

    const second = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "new-session-event",
      body: "新しい会話を始めます",
      receivedAt: new Date("2026-08-07T00:01:00.000Z"),
    });
    const secondTurn = await attachMessagesToTurn(db, [second], 2, "test-model");
    expect(secondTurn.sessionId).not.toBe(firstTurn.sessionId);
    await expect(markTurnGenerating(db, secondTurn.turnId)).resolves.toBe(true);
    await expect(markTurnFailed(db, secondTurn.turnId, "generation_exhausted")).resolves.toBe(true);
    await expect(markTurnDelivered(db, secondTurn.turnId)).resolves.toBe(false);

    await expect(attachMessagesToTurn(db, [first, second], 3, "test-model")).rejects.toThrow(
      "Existing conversation messages span multiple chat turns",
    );
  });
});
