import { createHmac } from "node:crypto";
import type { Queue, WebhookQueueMessage } from "@me-builder/shared";
import { describe, expect, it, vi } from "vitest";
import { receiveLineWebhook } from "./line-webhook";

const CHANNEL_SECRET = "test-channel-secret";

function sign(body: string): string {
  return createHmac("SHA256", CHANNEL_SECRET).update(body).digest("base64");
}

function textEvent(text: string, source: Record<string, string> = { type: "user", userId: "U1" }) {
  return {
    type: "message",
    replyToken: "reply-token",
    source,
    message: { type: "text", id: "message-id", text },
  };
}

function receive(
  events: unknown[],
  options: { startChatLoading?: (chatId: string) => Promise<unknown> } = {},
) {
  const body = JSON.stringify({ events });
  const send = vi.fn().mockResolvedValue(undefined);
  const queue: Queue<WebhookQueueMessage> = {
    send,
    sendBatch: vi.fn(),
    metrics: vi.fn(),
  };
  return {
    send,
    result: receiveLineWebhook({
      rawBody: body,
      signature: sign(body),
      channelSecret: CHANNEL_SECRET,
      queue,
      startChatLoading: options.startChatLoading,
    }),
  };
}

describe("receiveLineWebhook chat loading", () => {
  it.each(["診断", "AI: 今日の気分を整理して"])(
    "1対1のテキスト「%s」ではQueue投入前にローディングを開始する",
    async (text) => {
      const order: string[] = [];
      const startChatLoading = vi.fn(async () => {
        order.push("loading");
      });
      const { send, result } = receive([textEvent(text)], { startChatLoading });
      send.mockImplementation(async () => {
        order.push("queue");
      });

      await result;

      expect(startChatLoading).toHaveBeenCalledWith("U1");
      expect(order).toEqual(["loading", "queue"]);
    },
  );

  it("同じユーザーの複数イベントではローディングを1回だけ開始する", async () => {
    const startChatLoading = vi.fn().mockResolvedValue({});
    const { result } = receive([textEvent("診断"), textEvent("AI: 質問")], {
      startChatLoading,
    });

    await result;

    expect(startChatLoading).toHaveBeenCalledOnce();
  });

  it("グループトークと非テキストイベントではローディングを開始しない", async () => {
    const startChatLoading = vi.fn().mockResolvedValue({});
    const imageEvent = {
      ...textEvent(""),
      message: { type: "image", id: "image-id" },
    };
    const { result } = receive(
      [textEvent("診断", { type: "group", groupId: "G1", userId: "U1" }), imageEvent],
      { startChatLoading },
    );

    await result;

    expect(startChatLoading).not.toHaveBeenCalled();
  });

  it("ローディングAPIが失敗してもQueueへ投入する", async () => {
    const startChatLoading = vi.fn().mockRejectedValue(new Error("LINE unavailable"));
    const { send, result } = receive([textEvent("診断")], { startChatLoading });

    await expect(result).resolves.toMatchObject({ type: "accepted", queued: true });
    expect(send).toHaveBeenCalledOnce();
  });
});
