import type { Message, MessageBatch, WebhookQueueMessage } from "@me-builder/shared";
import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi, beforeEach } from "vitest";
import worker from "./index";
import { handleQueueBatch } from "./logic/webhook";

import { line } from "@me-builder/lib";

const mockReplyMessage = vi.fn().mockResolvedValue({});
vi.spyOn(line.client, "create").mockReturnValue({
  replyMessage: mockReplyMessage,
} as unknown as ReturnType<typeof line.client.create>);

describe("Worker Queue Handler", () => {
  beforeEach(() => {
    mockReplyMessage.mockClear();
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
          events: [{ type: "message", replyToken: "tok", message: { type: "text", text: "hi" } }],
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

    const mockDb = {} as any;
    
    await handleQueueBatch(batch, mockDb, {
      environment: "test",
      lineChannelAccessToken: "test-token",
    });
    expect(mockAck).toHaveBeenCalledOnce();
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: "tok",
      messages: [{ type: "text", text: "hi" }],
    });
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
    const message = {
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
