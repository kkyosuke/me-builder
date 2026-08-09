import type { D1Database } from "@cloudflare/workers-types";
import { d1, line } from "@me-builder/lib";
import type { Message, MessageBatch, WebhookQueueMessage } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkerConfig } from "./config";
import worker from "./index";
import { handleQueueBatch } from "./logic/webhook";

const mockPushMessage = vi.fn().mockResolvedValue({});
const mockReplyMessage = vi.fn().mockResolvedValue({});
const mockAcceptMessage = vi.fn().mockResolvedValue({ accepted: true });
const mockAccountDataExecute = vi.fn().mockResolvedValue({
  sourceRecordId: "source-1",
  accountId: "account-1",
  eventId: "webhook-event-1",
  receivedAt: new Date("2026-08-06T12:00:00Z"),
});
vi.spyOn(line.client, "create").mockReturnValue({
  pushMessage: mockPushMessage,
  replyMessage: mockReplyMessage,
} as unknown as ReturnType<typeof line.client.create>);
vi.spyOn(d1.action.account, "upsertIdentity").mockResolvedValue({
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

function createBatch(text: string): {
  batch: MessageBatch<WebhookQueueMessage>;
  message: Message<WebhookQueueMessage>;
} {
  const message = {
    id: "queue-message-1",
    timestamp: new Date("2026-08-06T12:00:00Z"),
    attempts: 1,
    body: {
      id: "queue-envelope-1",
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
  getByName: vi.fn(() => ({ acceptMessage: mockAcceptMessage })),
} as unknown as NonNullable<import("./types").Env["CONVERSATION_COORDINATOR"]>;
const accountDataNamespace = {
  getByName: vi.fn(() => ({ execute: mockAccountDataExecute })),
} as unknown as NonNullable<import("./types").Env["ACCOUNT_DATA"]>;

describe("Worker", () => {
  beforeEach(() => {
    mockPushMessage.mockClear();
    mockReplyMessage.mockClear();
    mockAcceptMessage.mockClear();
    mockAccountDataExecute.mockClear();
  });

  it("日記を原本保存してCoordinatorへ渡し、受付配送はAPI側の予約へ委ねる", async () => {
    const { batch, message } = createBatch("今日は散歩した");
    const db = {} as d1.Client;
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
      }),
    );
    expect(mockAcceptMessage).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "account-1", sourceRecordId: "source-1" }),
    );
    expect(mockPushMessage).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("診断キーワードは日記保存せずLIFF導線をpushする", async () => {
    const { batch } = createBatch("診断");
    await handleQueueBatch(
      batch,
      {} as d1.Client,
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
  });

  it("API routingとWorkerの再判定が不一致なら保存も返信もしない", async () => {
    const { batch, message } = createBatch("今日は散歩した");
    message.body.routing = {
      lineTextEvents: [{ eventId: "webhook-event-1", intent: "diagnosis-request" }],
    };

    await handleQueueBatch(batch, {} as d1.Client, getWorkerConfig({ ENVIRONMENT: "test" }));

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
