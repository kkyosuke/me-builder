import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import { storeLineTextSource } from "./diary";
import {
  completeWeeklyReflectionGeneration,
  failWeeklyReflectionGeneration,
  loadWeeklyReflectionGenerationContext,
  readWeeklyReflections,
  requestWeeklyReflectionGeneration,
} from "./weekly-reflection";

const ACCOUNT_ID = "weekly-account";
const NOW = new Date("2026-08-15T03:00:00.000Z");

function createTestDb(): AccountDataDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  type Runnable = PromiseLike<unknown> & { run(): unknown };
  Object.assign(db, {
    batch: async (queries: Runnable[]) =>
      sqlite.transaction(() => queries.map((query) => query.run()))(),
  });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle-do-account") });
  db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: ACCOUNT_ID }).run();
  return db as unknown as AccountDataDatabase;
}

async function addDiary(db: AccountDataDatabase, suffix: string, at: Date) {
  const source = await storeLineTextSource(db, {
    accountId: ACCOUNT_ID,
    eventId: `weekly-${suffix}`,
    body: `今週の日記 ${suffix}`,
    receivedAt: at,
  });
  await db.insert(schema.conversationSessions).values({
    id: `weekly-session-${suffix}`,
    accountId: ACCOUNT_ID,
    status: "closed",
    startedAt: at,
    lastUserMessageAt: at,
    closedAt: at,
    closeReason: "explicit",
  });
  await db.insert(schema.conversationMessages).values({
    id: `weekly-message-${suffix}`,
    sessionId: `weekly-session-${suffix}`,
    sequence: 1,
    role: "user",
    sourceRecordId: source.sourceRecordId,
    channel: "line",
  });
  return source.sourceRecordId;
}

describe("weekly reflection", () => {
  it("同じ週の要求を1件へまとめ、失敗した生成を同じIDで再試行する", async () => {
    const db = createTestDb();
    await addDiary(db, "one", NOW);

    const first = await requestWeeklyReflectionGeneration(db, ACCOUNT_ID, NOW);
    const duplicate = await requestWeeklyReflectionGeneration(db, ACCOUNT_ID, NOW);
    expect(first).toMatchObject({ outcome: "created", status: "queued" });
    expect(duplicate).toMatchObject({
      outcome: "existing",
      generationId: "generationId" in first ? first.generationId : "",
    });
    if (!("generationId" in first)) throw new Error("generation was not created");
    await failWeeklyReflectionGeneration(db, ACCOUNT_ID, first.generationId, "一時失敗", NOW);
    await expect(requestWeeklyReflectionGeneration(db, ACCOUNT_ID, NOW)).resolves.toMatchObject({
      outcome: "retried",
      generationId: first.generationId,
      status: "queued",
    });
  });

  it("今週の日記だけをAI境界へ渡し、通知停止時も結果を保存して閲覧できる", async () => {
    const db = createTestDb();
    await addDiary(db, "old", new Date("2026-08-01T03:00:00.000Z"));
    const currentSourceId = await addDiary(db, "current", NOW);
    await db
      .update(schema.dailyPromptPreferences)
      .set({
        status: "stopped",
        controlledAt: NOW,
        controlSourceRecordId: currentSourceId,
        updatedAt: NOW,
      })
      .run();
    const requested = await requestWeeklyReflectionGeneration(db, ACCOUNT_ID, NOW);
    if (!("generationId" in requested)) throw new Error("generation was not created");
    const context = await loadWeeklyReflectionGenerationContext(
      db,
      ACCOUNT_ID,
      requested.generationId,
      NOW,
    );
    expect(context?.evidence.map(({ text }) => text)).toEqual(["今週の日記 current"]);
    if (!context) throw new Error("context was not loaded");
    await completeWeeklyReflectionGeneration(db, ACCOUNT_ID, {
      generationId: context.generationId,
      generatedAt: NOW,
      model: "test-model",
      promptVersion: "weekly-reflection-v1",
      headline: "今週は立ち止まって考えました",
      items: [
        {
          kind: "question",
          title: "もう少し話せること",
          description: "今週、心に残った場面はありますか？",
          evidenceCount: 1,
          sources: ["diary"],
        },
      ],
      evidenceCount: 1,
    });
    await expect(readWeeklyReflections(db, ACCOUNT_ID, NOW)).resolves.toMatchObject({
      reflections: [{ weekStart: "2026-08-10", recordCount: 1 }],
      generation: { status: "completed", canGenerate: false, notification: "skipped" },
    });
  });
});
