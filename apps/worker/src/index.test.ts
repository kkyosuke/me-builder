import type { D1Database } from "@cloudflare/workers-types";
import type { Message, MessageBatch, WebhookQueueMessage } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkerConfig } from "./config";
import worker from "./index";
import { handleQueueBatch } from "./logic/webhook";

import { d1, line } from "@me-builder/lib";

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn().mockResolvedValue({ text: "AIからの返信" }),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

const mockReplyMessage = vi.fn().mockResolvedValue({});
vi.spyOn(line.client, "create").mockReturnValue({
  replyMessage: mockReplyMessage,
} as unknown as ReturnType<typeof line.client.create>);

vi.spyOn(d1.action.account, "upsertIdentity").mockResolvedValue({
  account: {
    id: "acc-123",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    isDeleted: false,
  },
  identity: {
    id: "ident-123",
    accountId: "acc-123",
    provider: "line",
    providerAccountId: "test-user",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    isDeleted: false,
  },
});

describe("Worker Queue Handler", () => {
  beforeEach(() => {
    mockReplyMessage.mockClear();
    mockGenerateContent.mockClear();
  });
  it("processes queue batch and acknowledges messages", async () => {
    const mockAck = vi.fn();
    const message: Message<WebhookQueueMessage> = {
      id: "msg-123",
      timestamp: new Date("2026-07-25T12:00:00Z"),
      attempts: 1,
      body: {
        id: "evt-123",
        source: "line",
        receivedAt: "2026-07-25T12:00:00Z",
        payload: {
          events: [
            {
              type: "message",
              replyToken: "tok",
              message: { type: "text", text: "hi" },
              source: { type: "user", userId: "test-user" },
            },
          ],
        },
      },
      ack: mockAck,
      retry: vi.fn(),
    };

    const batch = {
      queue: "me-builder-webhook-queue-local",
      messages: [message],
      metadata: {},
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<WebhookQueueMessage>;

    const mockDb = {} as unknown as d1.Client;

    await handleQueueBatch(
      batch,
      mockDb,
      getWorkerConfig({
        ENVIRONMENT: "test",
        LINE_CHANNEL_ACCESS_TOKEN: "test-token",
        LIFF_ID: "1234567890-abcdefgh",
      }),
    );
    expect(mockAck).toHaveBeenCalledOnce();
    // follow を取り逃していても、メッセージ受信時に Account を補完する
    expect(d1.action.account.upsertIdentity).toHaveBeenCalledWith(mockDb, {
      provider: "line",
      providerAccountId: "test-user",
    });
    // 送られた本文はオウム返しせず、受け付けた旨と診断への LIFF リンクを返す
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: "tok",
      messages: [
        {
          type: "text",
          text: "受け付けました。\n今日の診断に答える\nhttps://liff.line.me/1234567890-abcdefgh",
        },
      ],
    });
  });

  it("replies with the diagnosis link when the text asks for the diagnosis", async () => {
    const message = {
      id: "msg-124",
      timestamp: new Date("2026-07-25T12:00:00Z"),
      attempts: 1,
      body: {
        id: "evt-124",
        source: "line",
        receivedAt: "2026-07-25T12:00:00Z",
        payload: {
          events: [
            {
              type: "message",
              replyToken: "tok",
              message: { type: "text", text: "診断" },
              source: { type: "user", userId: "test-user" },
            },
          ],
        },
      },
      ack: vi.fn(),
      retry: vi.fn(),
    } as Message<WebhookQueueMessage>;

    const batch = {
      queue: "me-builder-webhook-queue-local",
      messages: [message],
      metadata: {},
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<WebhookQueueMessage>;

    await handleQueueBatch(
      batch,
      {} as unknown as d1.Client,
      getWorkerConfig({
        ENVIRONMENT: "test",
        LINE_CHANNEL_ACCESS_TOKEN: "test-token",
        LIFF_ID: "1234567890-abcdefgh",
      }),
    );

    // 日記の受付返信ではなく、診断のリンクだけを返す
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: "tok",
      messages: [
        {
          type: "text",
          text: "今日の診断に答える\nhttps://liff.line.me/1234567890-abcdefgh",
        },
      ],
    });
  });

  it("`AI:` に続く質問をGeminiへ送り、生成結果を返信すること", async () => {
    const message = {
      id: "msg-ai",
      timestamp: new Date("2026-07-25T12:00:00Z"),
      attempts: 1,
      body: {
        id: "evt-ai",
        source: "line",
        receivedAt: "2026-07-25T12:00:00Z",
        payload: {
          events: [
            {
              type: "message",
              replyToken: "ai-reply-token",
              message: { type: "text", text: "AI: Cloudflareとは？" },
              source: { type: "user", userId: "test-user" },
            },
          ],
        },
      },
      ack: vi.fn(),
      retry: vi.fn(),
    } as Message<WebhookQueueMessage>;
    const batch = {
      queue: "me-builder-webhook-queue-local",
      messages: [message],
      metadata: {},
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<WebhookQueueMessage>;

    await handleQueueBatch(
      batch,
      {} as unknown as d1.Client,
      getWorkerConfig({
        ENVIRONMENT: "test",
        LINE_CHANNEL_ACCESS_TOKEN: "test-token",
        GOOGLE_AI_STUDIO_API_KEY: "google-key",
        CLOUDFLARE_AIG_TOKEN: "gateway-token",
      }),
    );

    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: "gemini-3.5-flash-lite",
      contents: "Cloudflareとは？",
    });
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: "ai-reply-token",
      messages: [{ type: "text", text: "AIからの返信" }],
    });
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("fetch handler returns worker status", async () => {
    const req = new Request("http://localhost/");
    const res = await worker.fetch(req, { ENVIRONMENT: "test", DB: {} as unknown as D1Database });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.service).toBe("me-builder-worker");
  });

  it("queue handler catches unhandled error and rethrows", async () => {
    const _message = {
      id: "err-msg",
      timestamp: new Date(),
      attempts: 1,
      body: null as unknown as WebhookQueueMessage,
      ack: vi.fn(),
      retry: vi.fn(),
    } as Message<WebhookQueueMessage>;

    const batch = {
      queue: "test-queue",
      messages: [],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<WebhookQueueMessage>;

    await worker.queue(batch, { ENVIRONMENT: "test", DB: {} as unknown as D1Database });
    expect(batch.ackAll).not.toHaveBeenCalled();
  });
});
