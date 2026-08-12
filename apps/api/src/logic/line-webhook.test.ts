import { createHmac } from "node:crypto";
import { type Queue, type WebhookQueueMessage, logger } from "@me-builder/shared";
import { describe, expect, it, vi } from "vitest";
import { UNSUPPORTED_MESSAGE_REPLY_TEXT, receiveLineWebhook } from "./line-webhook";

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
  options: {
    startChatLoading?: (chatId: string) => Promise<unknown>;
    waitUntil?: (promise: Promise<unknown>) => void;
    replyUnsupportedMessage?: (replyToken: string, text: string) => Promise<unknown>;
    sendError?: Error;
  } = {},
) {
  const body = JSON.stringify({ events });
  const send = options.sendError
    ? vi.fn().mockRejectedValue(options.sendError)
    : vi.fn().mockResolvedValue(undefined);
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
      environment: "test",
      startChatLoading: options.startChatLoading,
      waitUntil: options.waitUntil ?? ((promise) => void promise),
      replyUnsupportedMessage: options.replyUnsupportedMessage,
    }),
  };
}

describe("receiveLineWebhook chat loading", () => {
  it.each(["診断", "AI: 今日の気分を整理して"])(
    "1対1のテキスト「%s」ではQueue投入前にローディングを開始する",
    async (text) => {
      const startChatLoading = vi.fn().mockResolvedValue({});
      const { send, result } = receive([textEvent(text)], { startChatLoading });

      await result;

      expect(startChatLoading).toHaveBeenCalledWith("U1");
      expect(startChatLoading.mock.invocationCallOrder[0]).toBeLessThan(
        send.mock.invocationCallOrder[0] ?? 0,
      );
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

  it("ローディングAPIの完了を待たずにQueueへ投入する", async () => {
    const startChatLoading = vi.fn(() => new Promise(() => {}));
    const waitUntil = vi.fn();
    const { send, result } = receive([textEvent("AI: 質問")], {
      startChatLoading,
      waitUntil,
    });

    await expect(result).resolves.toMatchObject({ type: "accepted", queued: true });
    expect(startChatLoading).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });
});

describe("receiveLineWebhook unsupported messages", () => {
  it.each(["image", "video", "audio", "file", "location", "sticker"])(
    "%sメッセージへ案内を返信し、Queueへ投入しない",
    async (messageType) => {
      const replyUnsupportedMessage = vi.fn().mockResolvedValue({});
      const event = {
        ...textEvent(""),
        replyToken: `reply-${messageType}`,
        message: { type: messageType, id: `${messageType}-id` },
      };
      const { send, result } = receive([event], { replyUnsupportedMessage });

      await expect(result).resolves.toMatchObject({ type: "accepted", queued: false });
      expect(replyUnsupportedMessage).toHaveBeenCalledWith(
        `reply-${messageType}`,
        UNSUPPORTED_MESSAGE_REPLY_TEXT,
      );
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("テキストと非テキストが混在すると、非テキストだけを除いてQueueへ投入する", async () => {
    const replyUnsupportedMessage = vi.fn().mockResolvedValue({});
    const imageEvent = {
      ...textEvent(""),
      replyToken: "reply-image",
      message: { type: "image", id: "image-id" },
    };
    const text = textEvent("今日は散歩した");
    const { send, result } = receive([imageEvent, text], { replyUnsupportedMessage });

    await expect(result).resolves.toMatchObject({ type: "accepted", queued: true });
    expect(replyUnsupportedMessage).toHaveBeenCalledOnce();
    const queued = send.mock.calls[0]?.[0] as WebhookQueueMessage;
    expect((queued.payload as { events: unknown[] }).events).toEqual([text]);
  });

  it("案内の返信に失敗しても非テキストをQueueへ投入しない", async () => {
    const replyUnsupportedMessage = vi.fn().mockRejectedValue(new Error("LINE unavailable"));
    const imageEvent = {
      ...textEvent(""),
      message: { type: "image", id: "image-id" },
    };
    const { send, result } = receive([imageEvent], { replyUnsupportedMessage });

    await expect(result).resolves.toMatchObject({ type: "accepted", queued: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("案内の返信完了を待たず、混在するテキストをQueueへ投入する", async () => {
    const replyUnsupportedMessage = vi.fn(() => new Promise<unknown>(() => {}));
    const waitUntil = vi.fn();
    const imageEvent = {
      ...textEvent(""),
      replyToken: "reply-image",
      message: { type: "image", id: "image-id" },
    };
    const { send, result } = receive([imageEvent, textEvent("今日は散歩した")], {
      replyUnsupportedMessage,
      waitUntil,
    });

    await expect(result).resolves.toMatchObject({ type: "accepted", queued: true });
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });
});

describe("replyTokenの受け渡し", () => {
  it("日記のfinalをreplyで返せるようreplyTokenをQueueへ残す", async () => {
    const { send, result } = receive([textEvent("本文")]);
    await result;
    const queued = send.mock.calls[0]?.[0] as WebhookQueueMessage;
    expect((queued.payload as { events: { replyToken?: string }[] }).events[0]?.replyToken).toBe(
      "reply-token",
    );
  });

  it("APIで発行した相関IDをWebhook Queueへ渡す", async () => {
    const { send, result } = receive([textEvent("本文")]);
    const outcome = await result;
    const queued = send.mock.calls[0]?.[0] as WebhookQueueMessage;

    expect(queued.traceId).toBe(queued.id);
    expect(outcome).toMatchObject({ type: "accepted", id: queued.traceId });
  });

  it("Queue投入失敗を相関IDと安全な原因分類で終端記録する", async () => {
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const queueError = new Error("本文やSDK responseを含みうる内容");
    const { send, result } = receive([textEvent("本文")], { sendError: queueError });

    await expect(result).rejects.toThrow("本文やSDK responseを含みうる内容");
    const queued = send.mock.calls[0]?.[0] as WebhookQueueMessage;
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "line.webhook.failed",
        traceId: queued.traceId,
        stage: "queue.send",
        errorCode: "WEBHOOK_QUEUE_SEND_FAILED",
        errorCategory: "dependency",
        retryable: true,
        dependency: "cloudflare-queue",
      }),
      expect.stringContaining("[LINE webhook] failed at queue.send -> http-error"),
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("本文やSDK response");
    errorLog.mockRestore();
  });
});
