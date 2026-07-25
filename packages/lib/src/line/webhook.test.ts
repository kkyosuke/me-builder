import { messagingApi } from "@line/bot-sdk";
import { describe, expect, it, vi } from "vitest";
import { line } from "./index";

vi.mock("@line/bot-sdk", () => {
  const replyMessageMock = vi.fn().mockResolvedValue({});
  return {
    messagingApi: {
      MessagingApiClient: vi.fn().mockImplementation(() => ({
        replyMessage: replyMessageMock,
      })),
    },
  };
});

describe("line.webhook.handleEvent", () => {
  it("returns zero counts for invalid or empty payload", async () => {
    const res1 = await line.webhook.handleEvent(null);
    expect(res1).toEqual({ processedCount: 0, repliedCount: 0 });

    const res2 = await line.webhook.handleEvent({});
    expect(res2).toEqual({ processedCount: 0, repliedCount: 0 });

    const res3 = await line.webhook.handleEvent({ events: [] });
    expect(res3).toEqual({ processedCount: 0, repliedCount: 0 });
  });

  it("skips reply if channelAccessToken is missing", async () => {
    const payload = {
      events: [
        {
          type: "message",
          replyToken: "token-123",
          message: { type: "text", text: "hello" },
        },
      ],
    };
    const res = await line.webhook.handleEvent(payload);
    expect(res).toEqual({ processedCount: 0, repliedCount: 0 });
  });

  it("calls replyMessage for valid text message event when token is present", async () => {
    const payload = {
      events: [
        {
          type: "message",
          replyToken: "reply-token-abc",
          message: { type: "text", text: "オウム返しテスト" },
        },
      ],
    };
    const res = await line.webhook.handleEvent(payload, "dummy-access-token");
    expect(res).toEqual({ processedCount: 1, repliedCount: 1 });

    const clientInstance = (messagingApi.MessagingApiClient as unknown as ReturnType<typeof vi.fn>)
      .mock.results[0]?.value;
    expect(clientInstance.replyMessage).toHaveBeenCalledWith({
      replyToken: "reply-token-abc",
      messages: [
        {
          type: "text",
          text: "オウム返しテスト",
        },
      ],
    });
  });
});
