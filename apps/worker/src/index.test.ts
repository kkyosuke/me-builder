import type { Message, MessageBatch, WebhookQueueMessage } from "@me-builder/shared";
import { describe, expect, it, vi } from "vitest";
import worker, { handleQueueBatch } from "./index";

import { line } from "@me-builder/lib";

vi.spyOn(line.webhook, "handleEvent").mockResolvedValue({
  processedCount: 1,
  repliedCount: 1,
});

describe("Worker Queue Handler", () => {
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

    await handleQueueBatch(batch, {
      environment: "development",
      lineChannelAccessToken: "test-token",
    });
    expect(mockAck).toHaveBeenCalledOnce();
    expect(line.webhook.handleEvent).toHaveBeenCalledWith(message.body.payload, "test-token");
  });

  it("fetch handler returns worker status", async () => {
    const res = await worker.fetch(new Request("http://localhost/"), { ENVIRONMENT: "test" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.service).toBe("me-builder-worker");
  });
});
