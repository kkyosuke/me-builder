import { describe, expect, it, vi } from "vitest";
import { app } from "./index";

describe("API Server Webhook Queue", () => {
  it("POST /api/line/webhook enqueues event to WEBHOOK_QUEUE if binding is provided", async () => {
    const mockSend = vi.fn().mockResolvedValue(undefined);
    const mockQueue = { send: mockSend };

    const res = await app.request(
      "/api/line/webhook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ type: "message", text: "hello" }] }),
      },
      { WEBHOOK_QUEUE: mockQueue },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.queued).toBe(true);
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0]).toMatchObject({
      source: "line",
      payload: { events: [{ type: "message", text: "hello" }] },
    });
  });

  it("POST /api/line/webhook handles request safely if WEBHOOK_QUEUE binding is absent", async () => {
    const res = await app.request("/api/line/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [] }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.queued).toBe(false);
  });
});
