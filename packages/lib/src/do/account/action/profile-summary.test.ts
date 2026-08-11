import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import { storeLineTextSource } from "./diary";
import {
  completeProfileSummaryGeneration,
  loadProfileSummaryGenerationContext,
  readProfileSummary,
  requestProfileSummaryGeneration,
} from "./profile-summary";

function createTestDb(): AccountDataDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  type RunnableQuery = PromiseLike<unknown> & { run(): unknown };
  const runBatch = sqlite.transaction((queries: RunnableQuery[]) =>
    queries.map((query) => query.run()),
  );
  Object.assign(db, { batch: async (queries: RunnableQuery[]) => runBatch(queries) });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle-do-account") });
  return db as unknown as AccountDataDatabase;
}

async function insertDiaryFixture(db: AccountDataDatabase) {
  const accountId = "account-1";
  const recordedAt = new Date("2026-08-08T00:00:00.000Z");
  await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });
  const source = await storeLineTextSource(db, {
    accountId,
    eventId: "event-summary-1",
    body: "Memoryにはしていないけれど、今日は海辺を長く歩いて落ち着いた。",
    receivedAt: recordedAt,
  });
  await db.insert(schema.conversationSessions).values({
    id: "session-summary-1",
    accountId,
    status: "closed",
    startedAt: recordedAt,
    lastUserMessageAt: recordedAt,
    closedAt: recordedAt,
    closeReason: "explicit",
  });
  await db.insert(schema.conversationMessages).values({
    id: "message-summary-1",
    sessionId: "session-summary-1",
    sequence: 1,
    role: "user",
    sourceRecordId: source.sourceRecordId,
    channel: "line",
  });
  return { accountId, recordedAt };
}

describe("Profile Summary persistence", () => {
  it("Memory化されていない日記からcontextを作り、不変版を冪等に保存する", async () => {
    const db = createTestDb();
    const { accountId, recordedAt } = await insertDiaryFixture(db);
    const requested = await requestProfileSummaryGeneration(
      db,
      accountId,
      new Date("2026-08-09T00:00:00.000Z"),
    );
    expect(requested).toMatchObject({ outcome: "created", status: "queued" });
    if (requested.outcome !== "created") throw new Error("generation was not created");
    await expect(requestProfileSummaryGeneration(db, accountId)).resolves.toMatchObject({
      outcome: "existing",
      generationId: requested.generationId,
    });

    const context = await loadProfileSummaryGenerationContext(
      db,
      accountId,
      requested.generationId,
    );
    expect(context).toMatchObject({ diagnosisCount: 0, diaryCount: 1 });
    expect(context?.evidence).toEqual([
      expect.objectContaining({
        source: "diary",
        text: "Memoryにはしていないけれど、今日は海辺を長く歩いて落ち着いた。",
      }),
    ]);
    if (!context) throw new Error("generation context was not loaded");

    const input = {
      generationId: requested.generationId,
      generatedAt: new Date("2026-08-09T00:01:00.000Z"),
      model: "gemini-test",
      promptVersion: "profile-summary-v1",
      headline: "歩く時間が気持ちを整えています",
      insights: [
        {
          key: "walking",
          label: "歩いて整える",
          description: "歩くことで落ち着きを取り戻すことがあります。",
          evidenceCount: 1,
          sources: ["diary" as const],
        },
      ],
      diagnosisCount: context.diagnosisCount,
      diaryCount: context.diaryCount,
      latestRecordedAt: context.latestRecordedAt,
    };
    await expect(completeProfileSummaryGeneration(db, accountId, input)).resolves.toBe(true);
    await expect(readProfileSummary(db, accountId)).resolves.toMatchObject({
      versions: [
        {
          sequence: 1,
          isLatest: true,
          summary: { headline: "歩く時間が気持ちを整えています", diaryCount: 1 },
        },
      ],
      generation: { status: "idle", canRegenerate: true },
    });
    await expect(
      completeProfileSummaryGeneration(db, accountId, {
        ...input,
        generatedAt: new Date("2026-08-09T00:02:00.000Z"),
        headline: "重複版",
        latestRecordedAt: recordedAt,
      }),
    ).resolves.toBe(true);
    expect((await readProfileSummary(db, accountId)).versions).toHaveLength(1);
  });

  it("利用できる入力がなければ生成要求を作らない", async () => {
    const db = createTestDb();
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });
    await expect(requestProfileSummaryGeneration(db, "account-1")).resolves.toEqual({
      outcome: "unavailable",
    });
  });
});
