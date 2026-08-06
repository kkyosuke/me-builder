import type { D1Database, DurableObjectNamespace } from "@cloudflare/workers-types";
import { d1, line } from "@me-builder/lib";
import type { Message, MessageBatch, WebhookQueueMessage } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkerConfig } from "./config";
import type { ConversationCoordinator } from "./conversation-coordinator";
import worker from "./index";
import { handleQueueBatch } from "./logic/webhook";

const mockPushMessage = vi.fn().mockResolvedValue({});
const mockReplyMessage = vi.fn().mockResolvedValue({});
const mockAcceptMessage = vi.fn().mockResolvedValue({ accepted: true });
vi.spyOn(line.client, "create").mockReturnValue({
  pushMessage: mockPushMessage,
  replyMessage: mockReplyMessage,
} as unknown as ReturnType<typeof line.client.create>);
vi.spyOn(d1.action.account, "upsertIdentity").mockResolvedValue({
  account: {
    id: "account-1",
    status: "active",
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
vi.spyOn(d1.action.conversation, "storeLineTextSource").mockResolvedValue({
  sourceRecordId: "source-1",
  accountId: "account-1",
  eventId: "webhook-event-1",
  receivedAt: new Date("2026-08-06T12:00:00Z"),
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
} as unknown as DurableObjectNamespace<ConversationCoordinator>;

describe("Worker", () => {
  beforeEach(() => {
    mockPushMessage.mockClear();
    mockReplyMessage.mockClear();
    mockAcceptMessage.mockClear();
    vi.mocked(d1.action.conversation.storeLineTextSource).mockClear();
  });

  it("日記を原本保存してCoordinatorへ渡し、pushで受付を返す", async () => {
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
        DB: {} as D1Database,
        CONVERSATION_COORDINATOR: coordinatorNamespace,
      },
    );

    expect(d1.action.conversation.storeLineTextSource).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        accountId: "account-1",
        eventId: "webhook-event-1",
        body: "今日は散歩した",
      }),
    );
    expect(mockAcceptMessage).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "account-1", sourceRecordId: "source-1" }),
    );
    expect(mockPushMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "line-user",
        messages: [expect.objectContaining({ text: expect.stringContaining("受け付けました") })],
      }),
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
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
    expect(d1.action.conversation.storeLineTextSource).not.toHaveBeenCalled();
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: "reply-token-1",
      messages: [{ type: "text", text: expect.stringContaining("liff.line.me/123-liff") }],
    });
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
