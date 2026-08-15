import path from "node:path";
import { type AccountDataNamespace, D1, line } from "@me-builder/lib";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
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

function lineEvent(text: string, replyToken: string | null = "reply-token-terms-1") {
  return {
    events: [
      {
        type: "message",
        webhookEventId: "webhook-event-terms-1",
        timestamp: Date.now(),
        ...(replyToken ? { replyToken } : {}),
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

  it("未同意の診断要求も診断処理へ進めず、規約リンクをreplyする", async () => {
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
      lineEvent("診断"),
      db,
      workerConfig,
      undefined,
      accountDataNamespace,
    );

    expect(result.resultCode).toBe("LINE_TERMS_ACCEPTANCE_REQUIRED");
    expect(execute).not.toHaveBeenCalled();
    expect(replyMessage).toHaveBeenCalledWith({
      replyToken: "reply-token-terms-1",
      messages: [{ type: "text", text: buildTermsAcceptanceReplyText(LIFF_ID) }],
    });
  });

  it("重要改定前の旧versionへ同意済みでもメッセージを保存しない", async () => {
    const db = createTestDb();
    const resolved = await D1.shared.action.account.resolveAccountByLineMessagingApi(
      db,
      PROVIDER_ACCOUNT_ID,
    );
    await D1.shared.action.agreement.acceptCurrentTerms(db, resolved.account.id);
    await db
      .update(D1.shared.schema.accountAgreementAcceptances)
      .set({
        documentVersion: "2026-01-01",
        documentHash: `sha256:${"1".repeat(64)}`,
      })
      .where(eq(D1.shared.schema.accountAgreementAcceptances.accountId, resolved.account.id))
      .run();
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

    expect(result.resultCode).toBe("LINE_TERMS_ACCEPTANCE_REQUIRED");
    expect(execute).not.toHaveBeenCalled();
    expect(replyMessage).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "replyTokenがない",
      config: workerConfig,
      event: lineEvent("今日は散歩した", null),
    },
    {
      name: "LIFF IDが設定されていない",
      config: getWorkerConfig({
        ENVIRONMENT: "test",
        LINE_CHANNEL_ACCESS_TOKEN: "line-token",
      }),
      event: lineEvent("今日は散歩した"),
    },
    {
      name: "LINEアクセストークンが設定されていない",
      config: getWorkerConfig({ ENVIRONMENT: "test", LIFF_ID }),
      event: lineEvent("今日は散歩した"),
    },
  ])("$name場合でも本人コンテンツを保存しない", async ({ config, event }) => {
    const db = createTestDb();
    const execute = vi.fn();
    const accountDataNamespace = {
      getByName: vi.fn(() => ({ execute })),
    } as unknown as AccountDataNamespace;
    const createLineClient = vi.spyOn(line.client, "create");

    const result = await processLineWebhook(event, db, config, undefined, accountDataNamespace);

    expect(result).toEqual({
      outcome: "degraded",
      stage: "terms.acceptance",
      resultCode: "LINE_TERMS_REPLY_NOT_CONFIGURED",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(createLineClient).not.toHaveBeenCalled();
  });

  it("LINEが規約案内を4xxで拒否しても本人コンテンツを保存しない", async () => {
    const db = createTestDb();
    const replyMessage = vi.fn().mockRejectedValue({ status: 400 });
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
      outcome: "degraded",
      stage: "terms.acceptance",
      resultCode: "LINE_TERMS_REPLY_REJECTED",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("LINEの到達結果が不明ならretryableエラーにし、本人コンテンツを保存しない", async () => {
    const db = createTestDb();
    const replyMessage = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.spyOn(line.client, "create").mockReturnValue({
      replyMessage,
    } as unknown as ReturnType<typeof line.client.create>);
    const execute = vi.fn();
    const accountDataNamespace = {
      getByName: vi.fn(() => ({ execute })),
    } as unknown as AccountDataNamespace;

    await expect(
      processLineWebhook(
        lineEvent("今日は散歩した"),
        db,
        workerConfig,
        undefined,
        accountDataNamespace,
      ),
    ).rejects.toMatchObject({
      code: "LINE_TERMS_REPLY_FAILED",
      stage: "terms.acceptance",
      retryable: true,
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
