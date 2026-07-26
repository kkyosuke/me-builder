import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { app } from "./index";

const CHANNEL_SECRET = "test-channel-secret";

/** LINE Platform と同じ手順 (HMAC-SHA256 → Base64) で署名を生成します。 */
function sign(body: string, channelSecret = CHANNEL_SECRET): string {
  return createHmac("SHA256", channelSecret).update(body).digest("base64");
}

function createMockQueue() {
  const send = vi.fn().mockResolvedValue(undefined);
  return { queue: { send }, send };
}

describe("POST /api/line/webhook signature verification", () => {
  it("accepts a request with a valid x-line-signature and enqueues the event", async () => {
    const { queue, send } = createMockQueue();
    const body = JSON.stringify({ events: [{ type: "message", text: "hello" }] });

    const res = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-line-signature": sign(body),
        },
        body,
      },
      { WEBHOOK_QUEUE: queue, LINE_CHANNEL_SECRET: CHANNEL_SECRET, ENVIRONMENT: "production" },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.queued).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({
      source: "line",
      payload: { events: [{ type: "message", text: "hello" }] },
    });
  });

  it("rejects a request whose x-line-signature does not match the body", async () => {
    const { queue, send } = createMockQueue();
    const body = JSON.stringify({ events: [{ type: "message", text: "hello" }] });

    const res = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-line-signature": sign(JSON.stringify({ events: [] })),
        },
        body,
      },
      { WEBHOOK_QUEUE: queue, LINE_CHANNEL_SECRET: CHANNEL_SECRET, ENVIRONMENT: "production" },
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a request signed with a different channel secret", async () => {
    const { queue, send } = createMockQueue();
    const body = JSON.stringify({ events: [] });

    const res = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-line-signature": sign(body, "attacker-secret"),
        },
        body,
      },
      { WEBHOOK_QUEUE: queue, LINE_CHANNEL_SECRET: CHANNEL_SECRET, ENVIRONMENT: "production" },
    );

    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a request without the x-line-signature header", async () => {
    const { queue, send } = createMockQueue();

    const res = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ type: "message", text: "hello" }] }),
      },
      { WEBHOOK_QUEUE: queue, LINE_CHANNEL_SECRET: CHANNEL_SECRET, ENVIRONMENT: "production" },
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects every request in production when LINE_CHANNEL_SECRET is not configured", async () => {
    const { queue, send } = createMockQueue();
    const body = JSON.stringify({ events: [] });

    const res = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-line-signature": sign(body) },
        body,
      },
      { WEBHOOK_QUEUE: queue, LINE_CHANNEL_SECRET: "", ENVIRONMENT: "production" },
    );

    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips verification outside production when LINE_CHANNEL_SECRET is not configured", async () => {
    const { queue, send } = createMockQueue();

    const res = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ type: "message", text: "hello" }] }),
      },
      { WEBHOOK_QUEUE: queue, LINE_CHANNEL_SECRET: "", ENVIRONMENT: "local" },
    );

    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
  });
});

describe("API Server Webhook Queue", () => {
  it("POST /api/line/webhook enqueues event to WEBHOOK_QUEUE if binding is provided", async () => {
    const { queue, send } = createMockQueue();
    const body = JSON.stringify({ events: [{ type: "message", text: "hello" }] });

    const res = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-line-signature": sign(body) },
        body,
      },
      { WEBHOOK_QUEUE: queue, LINE_CHANNEL_SECRET: CHANNEL_SECRET },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.queued).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({
      source: "line",
      payload: { events: [{ type: "message", text: "hello" }] },
    });
  });

  it("POST /api/line/webhook handles request safely if WEBHOOK_QUEUE binding is absent", async () => {
    const body = JSON.stringify({ events: [] });

    const res = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-line-signature": sign(body) },
        body,
      },
      { LINE_CHANNEL_SECRET: CHANNEL_SECRET },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.queued).toBe(false);
  });

  it("handles unhandled exception with 500 status using app.onError", async () => {
    const testApp = new (await import("hono")).Hono();
    testApp.onError((_err, c) => c.json({ error: "Internal Server Error" }, 500));
    testApp.get("/test-error", () => {
      throw new Error("Test error");
    });

    const res = await testApp.request("/test-error");
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data).toEqual({ error: "Internal Server Error" });
  });
});
