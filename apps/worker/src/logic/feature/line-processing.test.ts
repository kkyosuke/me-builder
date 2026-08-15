import path from "node:path";
import { type AccountDataNamespace, D1, line } from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWorkerConfig } from "../../config";
import { buildTermsAcceptanceReplyText, processLineWebhook } from "./line";

const LIFF_ID = "1234567890-terms-test";
const PROVIDER_ACCOUNT_ID = "U_terms_acceptance_test";

function createTestDb(): D1.shared.Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: D1.shared.schema });
  // biome-ignore lint/suspicious/noExplicitAny: drizzle の migrate はドライバごとの型を要求する
  migrate(db as any, {
    migrationsFolder: path.resolve(__dirname, "../../../../../packages/lib/drizzle"),
  });
  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      const results = [];
      for (const query of queries) results.push(await query);
      return results;
    },
  });
  return db as unknown as D1.shared.Client;
}

function lineEvent(text: string) {
  return {
    events: [
      {
        type: "message",
        webhookEventId: "webhook-event-terms-1",
        timestamp: Date.now(),
        replyToken: "reply-token-terms-1",
        message: { type: "text", id: "message-terms-1", text },
        source: { type: "user", userId: PROVIDER_ACCOUNT_ID },
      },
    ],
  };
}

const workerConfig = getWorkerConfig({
  ENVIRONMENT: "test",
  LINE_CHANNEL_ACCESS_TOKEN: "line-token",
  LIFF_ID,
});

describe("LINE terms acceptance gate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("未同意のメッセージを保存せず、規約LIFFリンクをreplyする", async () => {
    const db = createTestDb();
    const replyMessage = vi.fn().mockResolvedValue({});
    vi.spyOn(line.client, "create").mockReturnValue({
      replyMessage,
    } as unknown as ReturnType<typeof line.client.create>);
    const execute = vi.fn();
    const accountDataNamespace = {
      getByName: vi.fn(() => ({ execute })),
    } as unknown as AccountDataNamespace;

    const result = await processLineWebhook(
      lineEvent("今日は散歩した"),
      db,
      workerConfig,
      undefined,
      accountDataNamespace,
    );

    expect(result).toEqual({
      outcome: "discarded",
      stage: "terms.acceptance",
      resultCode: "LINE_TERMS_ACCEPTANCE_REQUIRED",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(replyMessage).toHaveBeenCalledWith({
      replyToken: "reply-token-terms-1",
      messages: [{ type: "text", text: buildTermsAcceptanceReplyText(LIFF_ID) }],
    });
  });

  it("同意後に再送されたメッセージだけを保存処理へ渡す", async () => {
    const db = createTestDb();
    const resolved = await D1.shared.action.account.resolveAccountByLineMessagingApi(
      db,
      PROVIDER_ACCOUNT_ID,
    );
    await D1.shared.action.agreement.acceptCurrentTerms(db, resolved.account.id);
    const execute = vi.fn().mockResolvedValue({ sourceRecordId: "source-1" });
    const accountDataNamespace = {
      getByName: vi.fn(() => ({ execute })),
    } as unknown as AccountDataNamespace;

    const result = await processLineWebhook(
      lineEvent("今日は散歩した"),
      db,
      workerConfig,
      undefined,
      accountDataNamespace,
    );

    expect(result).toEqual({
      outcome: "degraded",
      stage: "source.store",
      resultCode: "CHAT_NOT_CONFIGURED",
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[1]).toBe("conversation.storeLineTextSource");
  });
});
