import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import { storeGeminiUsage, summarizeGeminiUsage } from "./gemini-usage";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  return db as unknown as SharedD1Client;
}

const usage = {
  responseId: "response-1",
  accountId: "account-1",
  operation: "diary_chat" as const,
  model: "gemini-test",
  promptTokenCount: 100,
  candidatesTokenCount: 20,
  thoughtsTokenCount: 5,
  cachedContentTokenCount: 10,
  toolUsePromptTokenCount: 2,
  totalTokenCount: 127,
  generatedAt: new Date("2026-08-10T01:00:00.000Z"),
};

describe("Gemini usage actions", () => {
  it("responseId単位で冪等保存し、期間内のtoken数を集計する", async () => {
    const db = createTestDb();
    await storeGeminiUsage(db, usage);
    await storeGeminiUsage(db, usage);
    await storeGeminiUsage(db, {
      ...usage,
      responseId: "response-2",
      accountId: "account-2",
      promptTokenCount: 50,
      candidatesTokenCount: 30,
      totalTokenCount: 87,
    });
    await storeGeminiUsage(db, {
      ...usage,
      responseId: "response-outside-range",
      generatedAt: new Date("2026-07-31T23:59:59.000Z"),
    });

    await expect(
      summarizeGeminiUsage(
        db,
        new Date("2026-08-01T00:00:00.000Z"),
        new Date("2026-09-01T00:00:00.000Z"),
      ),
    ).resolves.toEqual({
      requestCount: 2,
      inputTokens: 150,
      outputTokens: 50,
      thoughtsTokens: 10,
      cachedContentTokens: 20,
      toolUsePromptTokens: 4,
      totalTokens: 214,
      accounts: [
        { accountId: "account-1", requestCount: 1, inputTokens: 100, outputTokens: 20 },
        { accountId: "account-2", requestCount: 1, inputTokens: 50, outputTokens: 30 },
      ],
    });
  });

  it("不正なtoken数を保存しない", async () => {
    await expect(
      storeGeminiUsage(createTestDb(), { ...usage, promptTokenCount: -1 }),
    ).rejects.toThrow("promptTokenCount must be a non-negative safe integer");
  });
});
