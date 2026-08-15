import type { D1Database } from "@cloudflare/workers-types";
import { D1, line } from "@me-builder/lib";
import {
  type Message,
  type MessageBatch,
  type WebhookQueueMessage,
  logger,
} from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkerConfig } from "./config";
import worker from "./index";
import { handleQueueBatch } from "./logic/webhook";

const mockPushMessage = vi.fn().mockResolvedValue({});
const mockReplyMessage = vi.fn().mockResolvedValue({});
const mockAcceptMessage = vi.fn().mockResolvedValue({ accepted: true });
const mockGetResetEpoch = vi.fn().mockResolvedValue(0);
const mockAccountDataExecute = vi.fn().mockResolvedValue({
  sourceRecordId: "source-1",
  accountId: "account-1",
  eventId: "webhook-event-1",
  receivedAt: new Date("2026-08-06T12:00:00Z"),
});
const mockInfoLog = vi.spyOn(logger, "info").mockImplementation(() => undefined);
const mockWarnLog = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
const mockErrorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);
vi.spyOn(line.client, "create").mockReturnValue({
  pushMessage: mockPushMessage,
  replyMessage: mockReplyMessage,
} as unknown as ReturnType<typeof line.client.create>);
vi.spyOn(D1.shared.action.account, "resolveAccountByLineMessagingApi").mockResolvedValue({
  account: {
    id: "account-1",
    status: "active",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    isDeleted: false,
  },
  identity: {
    id: "identity-1",
    accountId: "account-1",
    provider: "line",
    providerAccountId: "line-user",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    isDeleted: false,
  },
});
const mockHasAcceptedCurrentTerms = vi
  .spyOn(D1.shared.action.agreement, "hasAcceptedCurrentTerms")
  .mockResolvedValue(true);

function createBatch(
  text: string,
  includeTraceId = true,
): {
  batch: MessageBatch<WebhookQueueMessage>;
  message: Message<WebhookQueueMessage>;
} {
  const message = {
    id: "queue-message-1",
    timestamp: new Date("2026-08-06T12:00:00Z"),
    attempts: 1,
    body: {
      id: "queue-envelope-1",
      ...(includeTraceId ? { traceId: "trace-1" } : {}),
      source: "line",
      receivedAt: "2026-08-06T12:00:00Z",
      routing: {
        lineTextEvents: [
          {
            eventId: "webhook-event-1",
            intent: line.text.classify(text),
          },
        ],
      },
      payload: {
        events: [
          {
            type: "message",
            webhookEventId: "webhook-event-1",
            replyToken: "reply-token-1",
            timestamp: new Date("2026-08-06T12:00:00Z").getTime(),
            message: { type: "text", id: "line-message-1", text },
            source: { type: "user", userId: "line-user" },
          },
        ],
      },
    },
    ack: vi.fn(),
    retry: vi.fn(),
  } as Message<WebhookQueueMessage>;
  return {
    message,
    batch: {
      queue: "me-builder-webhook-queue-local",
      messages: [message],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<WebhookQueueMessage>,
  };
}

const coordinatorNamespace = {
  getByName: vi.fn(() => ({
    acceptMessage: mockAcceptMessage,
    getResetEpoch: mockGetResetEpoch,
  })),
} as unknown as NonNullable<import("./types").Env["CONVERSATION_COORDINATOR"]>;
const accountDataNamespace = {
  getByName: vi.fn(() => ({ execute: mockAccountDataExecute })),
} as unknown as NonNullable<import("./types").Env["ACCOUNT_DATA"]>;

describe("Worker", () => {
  beforeEach(() => {
    mockPushMessage.mockClear();
    mockReplyMessage.mockReset().mockResolvedValue({});
    mockAcceptMessage.mockClear();
    mockGetResetEpoch.mockClear();
    mockAccountDataExecute.mockClear();
    mockInfoLog.mockClear();
    mockWarnLog.mockClear();
    mockErrorLog.mockClear();
    mockHasAcceptedCurrentTerms.mockReset().mockResolvedValue(true);
  });

  it("日記を原本保存してCoordinatorへ渡し、受付配送はAPI側の予約へ委ねる", async () => {
    const { batch, message } = createBatch("今日は散歩した");
    const db = {} as D1.shared.Client;
    await handleQueueBatch(
      batch,
      db,
      getWorkerConfig({
        ENVIRONMENT: "test",
        LINE_CHANNEL_ACCESS_TOKEN: "line-token",
        CHAT_DELIVERY_SECRET: "delivery-secret",
      }),
      {
        d1: db,
        do: { conversation: coordinatorNamespace, accountData: accountDataNamespace },
        queue: { chatTurn: undefined, brainCheckpoint: undefined },
      },
    );

    expect(mockAccountDataExecute).toHaveBeenCalledWith(
      "account-1",
      "conversation.storeLineTextSource",
      expect.objectContaining({
        eventId: "webhook-event-1",
        body: "今日は散歩した",
        resetEpoch: 0,
      }),
    );
    expect(mockAcceptMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-1",
        resetEpoch: 0,
        sourceRecordId: "source-1",
        traceId: "trace-1",
      }),
    );
    expect(mockPushMessage).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(mockInfoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "queue.message.completed",
        traceId: "trace-1",
        stage: "chat.accept",
        outcome: "succeeded",
        disposition: "ack",
      }),
      expect.stringContaining("[LINE webhook] succeeded at chat.accept -> ack"),
    );
  });

  it("明示的な声かけ停止をAccountDataへ渡し、通常の日記会話も継続する", async () => {
    const { batch, message } = createBatch("毎日の声かけを停止してください");
    const db = {} as D1.shared.Client;

    await handleQueueBatch(batch, db, getWorkerConfig({ ENVIRONMENT: "test" }), {
      d1: db,
      do: { conversation: coordinatorNamespace, accountData: accountDataNamespace },
      queue: { chatTurn: undefined, brainCheckpoint: undefined },
    });

    expect(mockAccountDataExecute).toHaveBeenCalledWith(
      "account-1",
      "conversation.storeLineTextSource",
      expect.objectContaining({
        body: "毎日の声かけを停止してください",
        dailyPromptControl: "stop",
      }),
    );
    expect(mockAcceptMessage).toHaveBeenCalledOnce();
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("AccountDataの失敗を安全に分類し、同じ相関IDで再試行を記録する", async () => {
    const { batch, message } = createBatch("今日は散歩した");
    mockAccountDataExecute.mockRejectedValueOnce(
      new Error("日記本文やSDK responseを含む可能性がある内容"),
    );

    await handleQueueBatch(
      batch,
      {} as D1.shared.Client,
      getWorkerConfig({ ENVIRONMENT: "test" }),
      {
        d1: {} as D1.shared.Client,
        do: { conversation: coordinatorNamespace, accountData: accountDataNamespace },
        queue: { chatTurn: undefined, brainCheckpoint: undefined },
      },
    );

    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
    const failureLogs = mockErrorLog.mock.calls.filter(
      ([fields]) =>
        typeof fields === "object" &&
        fields !== null &&
        "event" in fields &&
        fields.event === "queue.message.failed",
    );
    expect(failureLogs).toHaveLength(1);
    expect(failureLogs[0]?.[0]).toMatchObject({
      traceId: "trace-1",
      stage: "source.store",
      errorCode: "LINE_SOURCE_STORE_FAILED",
      errorCategory: "dependency",
      dependency: "account-data",
      retryable: true,
      disposition: "retry",
    });
    expect(JSON.stringify(failureLogs)).not.toContain("日記本文");
    expect(JSON.stringify(failureLogs)).not.toContain("SDK response");
  });

  it("旧Webhook Queue messageでは既存のenvelope IDを相関IDとして補う", async () => {
    const { batch } = createBatch("今日は散歩した", false);

    await handleQueueBatch(
      batch,
      {} as D1.shared.Client,
      getWorkerConfig({ ENVIRONMENT: "test" }),
      {
        d1: {} as D1.shared.Client,
        do: { conversation: coordinatorNamespace, accountData: accountDataNamespace },
        queue: { chatTurn: undefined, brainCheckpoint: undefined },
      },
    );

    expect(mockAcceptMessage).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "queue-envelope-1" }),
    );
    expect(mockInfoLog).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "queue-envelope-1" }),
      expect.stringContaining("[LINE webhook] succeeded at"),
    );
  });

  it("最終attemptの失敗はDLQへ向かうことを記録する", async () => {
    const { batch, message } = createBatch("今日は散歩した");
    Object.defineProperty(message, "attempts", { value: 4 });
    mockAccountDataExecute.mockRejectedValueOnce(new Error("temporary failure"));

    await handleQueueBatch(
      batch,
      {} as D1.shared.Client,
      getWorkerConfig({ ENVIRONMENT: "test" }),
      {
        d1: {} as D1.shared.Client,
        do: { conversation: coordinatorNamespace, accountData: accountDataNamespace },
        queue: { chatTurn: undefined, brainCheckpoint: undefined },
      },
    );

    expect(message.retry).toHaveBeenCalledOnce();
    expect(mockErrorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-1",
        attempt: 4,
        disposition: "dead-letter",
      }),
      expect.stringContaining("[LINE webhook] failed at source.store -> dead-letter (attempt 4/4"),
    );
  });

  it("診断キーワードは日記保存せずLIFF導線をreplyする", async () => {
    const { batch, message } = createBatch("診断");
    await handleQueueBatch(
      batch,
      {} as D1.shared.Client,
      getWorkerConfig({
        ENVIRONMENT: "test",
        LINE_CHANNEL_ACCESS_TOKEN: "line-token",
        CHAT_DELIVERY_SECRET: "delivery-secret",
        LIFF_ID: "123-liff",
      }),
    );
    expect(mockAccountDataExecute).not.toHaveBeenCalled();
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: "reply-token-1",
      messages: [{ type: "text", text: expect.stringContaining("liff.line.me/123-liff") }],
    });
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("使用済みreplyTokenは恒久的な拒否としてackし、最終attemptでもDLQへ送らない", async () => {
    const { batch, message } = createBatch("診断");
    Object.defineProperty(message, "attempts", { value: 4 });
    mockReplyMessage.mockRejectedValueOnce({ status: 400 });

    await handleQueueBatch(
      batch,
      {} as D1.shared.Client,
      getWorkerConfig({
        ENVIRONMENT: "test",
        LINE_CHANNEL_ACCESS_TOKEN: "line-token",
        LIFF_ID: "123-liff",
      }),
    );

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(mockErrorLog).not.toHaveBeenCalled();
    expect(mockWarnLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "queue.message.completed",
        outcome: "degraded",
        disposition: "ack",
        stage: "line.reply",
        resultCode: "LINE_DIAGNOSIS_REPLY_REJECTED",
      }),
      expect.stringContaining("[LINE webhook] degraded at line.reply -> ack"),
    );
  });

  it("LINEの一時障害は診断返信を再試行する", async () => {
    const { batch, message } = createBatch("診断");
    mockReplyMessage.mockRejectedValueOnce({ status: 500 });

    await handleQueueBatch(
      batch,
      {} as D1.shared.Client,
      getWorkerConfig({
        ENVIRONMENT: "test",
        LINE_CHANNEL_ACCESS_TOKEN: "line-token",
        LIFF_ID: "123-liff",
      }),
    );

    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
    expect(mockErrorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "LINE_DIAGNOSIS_REPLY_FAILED",
        retryable: true,
        disposition: "retry",
        stage: "line.reply",
      }),
      expect.stringContaining("[LINE webhook] failed at line.reply -> retry"),
    );
  });

  it("同じ診断Webhookの再配送でもユーザーへの返信は1通だけになる", async () => {
    const first = createBatch("診断");
    const redelivery = createBatch("診断");
    let deliveredCount = 0;
    mockReplyMessage.mockImplementation(async () => {
      if (deliveredCount === 0) {
        deliveredCount += 1;
        return {};
      }
      throw { status: 400 };
    });
    const config = getWorkerConfig({
      ENVIRONMENT: "test",
      LINE_CHANNEL_ACCESS_TOKEN: "line-token",
      LIFF_ID: "123-liff",
    });

    await handleQueueBatch(first.batch, {} as D1.shared.Client, config);
    await handleQueueBatch(redelivery.batch, {} as D1.shared.Client, config);

    expect(mockReplyMessage).toHaveBeenCalledTimes(2);
    expect(deliveredCount).toBe(1);
    expect(first.message.ack).toHaveBeenCalledOnce();
    expect(redelivery.message.ack).toHaveBeenCalledOnce();
    expect(first.message.retry).not.toHaveBeenCalled();
    expect(redelivery.message.retry).not.toHaveBeenCalled();
  });

  it("API routingとWorkerの再判定が不一致なら保存も返信もしない", async () => {
    const { batch, message } = createBatch("今日は散歩した");
    message.body.routing = {
      lineTextEvents: [{ eventId: "webhook-event-1", intent: "diagnosis-request" }],
    };

    await handleQueueBatch(batch, {} as D1.shared.Client, getWorkerConfig({ ENVIRONMENT: "test" }));

    expect(mockAccountDataExecute).not.toHaveBeenCalled();
    expect(mockReplyMessage).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("fetch handlerがWorker状態を返す", async () => {
    const response = await worker.fetch(new Request("http://localhost/"), {
      ENVIRONMENT: "test",
      DB: {} as D1Database,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "me-builder-worker",
    });
  });
});
