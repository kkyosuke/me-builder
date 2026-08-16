import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import {
  AI_USAGE_RESERVATION_TTL_MS,
  commitAiUsage,
  readAiUsage,
  releaseAiUsage,
  reserveAiUsage,
} from "./ai-usage";

const ACCOUNT_ID = "account-1";
const PERIOD = {
  key: "2026-08",
  start: new Date("2026-08-01T00:00:00.000Z"),
  end: new Date("2026-09-01T00:00:00.000Z"),
};
const NOW = new Date("2026-08-15T00:00:00.000Z");

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
  db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: ACCOUNT_ID }).run();
  return db as unknown as AccountDataDatabase;
}

describe("AI usage ledger", () => {
  it("同じrequestの並行retryを1件だけ予約する", async () => {
    const db = createTestDb();
    const input = { requestId: "request-1", kind: "ai-reply" as const, period: PERIOD, limit: 1 };

    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveAiUsage(db, ACCOUNT_ID, input, NOW)),
    );

    expect(results.filter(({ outcome }) => outcome === "reserved")).toHaveLength(1);
    expect(results.filter(({ outcome }) => outcome === "existing")).toHaveLength(9);
    expect(db.select().from(schema.aiUsageRecords).all()).toHaveLength(1);
    expect(await readAiUsage(db, ACCOUNT_ID, "ai-reply", PERIOD, 1, NOW)).toMatchObject({
      reserved: 1,
      committed: 0,
      remaining: 0,
    });
  });

  it("並行要求でも上限を超えない", async () => {
    const db = createTestDb();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        reserveAiUsage(
          db,
          ACCOUNT_ID,
          { requestId: `request-${index}`, kind: "ai-reply", period: PERIOD, limit: 3 },
          NOW,
        ),
      ),
    );

    expect(results.filter(({ outcome }) => outcome === "reserved")).toHaveLength(3);
    expect(results.filter(({ outcome }) => outcome === "limit-reached")).toHaveLength(5);
    expect(await readAiUsage(db, ACCOUNT_ID, "ai-reply", PERIOD, 3, NOW)).toMatchObject({
      reserved: 3,
      committed: 0,
      remaining: 0,
    });
  });

  it("成功を一度だけ確定し、確定済み利用量を解放しない", async () => {
    const db = createTestDb();
    await reserveAiUsage(
      db,
      ACCOUNT_ID,
      { requestId: "request-commit", kind: "profile-summary", period: PERIOD, limit: 4 },
      NOW,
    );

    await expect(commitAiUsage(db, ACCOUNT_ID, "request-commit", NOW)).resolves.toMatchObject({
      outcome: "committed",
      reservation: { status: "committed" },
    });
    await expect(commitAiUsage(db, ACCOUNT_ID, "request-commit", NOW)).resolves.toMatchObject({
      outcome: "unchanged",
      reservation: { status: "committed" },
    });
    await expect(releaseAiUsage(db, ACCOUNT_ID, "request-commit", NOW)).resolves.toMatchObject({
      outcome: "unchanged",
      reservation: { status: "committed" },
    });
    expect(await readAiUsage(db, ACCOUNT_ID, "profile-summary", PERIOD, 4, NOW)).toMatchObject({
      reserved: 0,
      committed: 1,
      remaining: 3,
    });
  });

  it("開始前失敗の予約を解放し、retryでも利用量を負数にしない", async () => {
    const db = createTestDb();
    await reserveAiUsage(
      db,
      ACCOUNT_ID,
      { requestId: "request-release", kind: "ai-reply", period: PERIOD, limit: 1 },
      NOW,
    );

    await expect(releaseAiUsage(db, ACCOUNT_ID, "request-release", NOW)).resolves.toMatchObject({
      outcome: "released",
      reservation: { status: "released", releaseReason: "cancelled" },
    });
    await expect(releaseAiUsage(db, ACCOUNT_ID, "request-release", NOW)).resolves.toMatchObject({
      outcome: "unchanged",
      reservation: { status: "released" },
    });
    expect(await readAiUsage(db, ACCOUNT_ID, "ai-reply", PERIOD, 1, NOW)).toMatchObject({
      reserved: 0,
      committed: 0,
      remaining: 1,
    });
  });

  it("timeoutした予約を自動解放する", async () => {
    const db = createTestDb();
    await reserveAiUsage(
      db,
      ACCOUNT_ID,
      { requestId: "request-timeout", kind: "ai-reply", period: PERIOD, limit: 1 },
      NOW,
    );
    const afterTimeout = new Date(NOW.getTime() + AI_USAGE_RESERVATION_TTL_MS);

    expect(await readAiUsage(db, ACCOUNT_ID, "ai-reply", PERIOD, 1, afterTimeout)).toMatchObject({
      reserved: 0,
      committed: 0,
      remaining: 1,
    });
    expect(db.select().from(schema.aiUsageRecords).get()).toMatchObject({
      status: "released",
      releaseReason: "timeout",
    });
  });

  it("期間とPlan上限が変わっても過去履歴を保持する", async () => {
    const db = createTestDb();
    await reserveAiUsage(
      db,
      ACCOUNT_ID,
      { requestId: "request-old", kind: "ai-reply", period: PERIOD, limit: 20 },
      NOW,
    );
    await commitAiUsage(db, ACCOUNT_ID, "request-old", NOW);
    const nextPeriod = {
      key: "2026-09",
      start: PERIOD.end,
      end: new Date("2026-10-01T00:00:00.000Z"),
    };
    const nextAt = nextPeriod.start;

    await expect(
      reserveAiUsage(
        db,
        ACCOUNT_ID,
        { requestId: "request-new", kind: "ai-reply", period: nextPeriod, limit: 150 },
        nextAt,
      ),
    ).resolves.toMatchObject({ outcome: "reserved", usage: { remaining: 149 } });
    expect(db.select().from(schema.aiUsageRecords).all()).toHaveLength(2);
    expect(await readAiUsage(db, ACCOUNT_ID, "ai-reply", PERIOD, 20, nextAt)).toMatchObject({
      committed: 1,
    });
  });
});
