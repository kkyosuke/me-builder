import { createHmac } from "node:crypto";
import type { WebhookQueueMessage } from "@me-builder/shared";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";

const channelSecret = "line-webhook-e2e-secret";

function signature(body: string): string {
  return createHmac("sha256", channelSecret).update(body).digest("base64");
}

function linePayload(): Record<string, unknown> {
  return {
    destination: "U_destination_e2e",
    events: [
      {
        type: "message",
        webhookEventId: "webhook-event-diagnosis-e2e",
        timestamp: 1_785_801_600_000,
        replyToken: "reply-token-diagnosis-e2e",
        source: { type: "user", userId: "U_line_webhook_e2e" },
        message: { type: "text", id: "message-diagnosis-e2e", text: "診断" },
      },
      {
        type: "message",
        webhookEventId: "webhook-event-diary-e2e",
        timestamp: 1_785_801_601_000,
        replyToken: "reply-token-diary-e2e",
        source: { type: "user", userId: "U_line_webhook_e2e" },
        message: { type: "text", id: "message-diary-e2e", text: "今日は散歩できた" },
      },
    ],
  };
}

describe("POST /api/line/webhook Queue boundary E2E", () => {
  it("生ボディの署名を検証し、APIで確定したroutingと原本をQueueへ投入する", async () => {
    const payload = linePayload();
    const rawBody = JSON.stringify(payload);
    const send = vi.fn<(message: WebhookQueueMessage) => Promise<void>>().mockResolvedValue();

    const response = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-line-signature": signature(rawBody),
        },
        body: rawBody,
      },
      {
        ENVIRONMENT: "test",
        LINE_CHANNEL_SECRET: channelSecret,
        WEBHOOK_QUEUE: { send } as never,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      queued: true,
      id: expect.any(String),
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      id: expect.any(String),
      source: "line",
      receivedAt: expect.any(String),
      payload,
      routing: {
        lineTextEvents: [
          { eventId: "webhook-event-diagnosis-e2e", intent: "diagnosis-request" },
          { eventId: "webhook-event-diary-e2e", intent: "diary" },
        ],
      },
    });
  });

  it("署名後に本文が変更された場合は401にしてQueueへ投入しない", async () => {
    const signedBody = JSON.stringify(linePayload());
    const tamperedBody = signedBody.replace("今日は散歩できた", "本文を改ざんした");
    const send = vi.fn<(message: WebhookQueueMessage) => Promise<void>>().mockResolvedValue();

    const response = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: { "x-line-signature": signature(signedBody) },
        body: tamperedBody,
      },
      {
        ENVIRONMENT: "test",
        LINE_CHANNEL_SECRET: channelSecret,
        WEBHOOK_QUEUE: { send } as never,
      },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(send).not.toHaveBeenCalled();
  });

  it("チャネルシークレット未設定時は署名検証を省略せず401にする", async () => {
    const rawBody = JSON.stringify(linePayload());
    const send = vi.fn<(message: WebhookQueueMessage) => Promise<void>>().mockResolvedValue();

    const response = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: { "x-line-signature": signature(rawBody) },
        body: rawBody,
      },
      { ENVIRONMENT: "test", WEBHOOK_QUEUE: { send } as never },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(send).not.toHaveBeenCalled();
  });
});
