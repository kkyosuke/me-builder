import { createHmac } from "node:crypto";
import { d1 } from "@me-builder/lib";
import type { ConversationCoordinatorNamespace } from "@me-builder/shared";
import type { Queue, WebhookQueueMessage } from "@me-builder/shared";
import { describe, expect, it, vi } from "vitest";
import { receiveLineWebhook, removeDiaryReplyTokens } from "./line-webhook";

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
  } = {},
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
      waitUntil: options.waitUntil ?? ((promise) => void promise),
    }),
  };
}

describe("receiveLineWebhook chat loading", () => {
  it("QueueへreplyTokenを渡さない", async () => {
    const { send, result } = receive([textEvent("日記")]);
    await result;
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          events: [expect.not.objectContaining({ replyToken: expect.anything() })],
        }),
      }),
    );
  });
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

describe("receiveLineWebhook receipt reservation", () => {
  it("日記receiptをWebhook Queueと独立してAccountのCoordinatorへ予約する", async () => {
    const reserveReceipt = vi.fn().mockResolvedValue({ accepted: true });
    const coordinator = {
      getByName: vi.fn(() => ({ reserveReceipt })),
    } as unknown as ConversationCoordinatorNamespace;
    const upsert = vi.spyOn(d1.action.account, "upsertIdentity").mockResolvedValue({
      account: { id: "account-1" },
    } as Awaited<ReturnType<typeof d1.action.account.upsertIdentity>>);
    const body = JSON.stringify({
      events: [
        {
          ...textEvent("今日は散歩した"),
          webhookEventId: "event-1",
          timestamp: new Date("2026-08-07T00:00:00Z").getTime(),
        },
      ],
    });
    let reservation: Promise<unknown> | undefined;
    const send = vi.fn().mockResolvedValue(undefined);

    await receiveLineWebhook({
      rawBody: body,
      signature: sign(body),
      channelSecret: CHANNEL_SECRET,
      queue: { send, sendBatch: vi.fn(), metrics: vi.fn() },
      db: {} as d1.Client,
      coordinator,
      waitUntil: (promise) => {
        reservation = promise;
      },
    });
    await reservation;

    expect(send).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(expect.anything(), {
      provider: "line",
      providerAccountId: "U1",
    });
    expect(coordinator.getByName).toHaveBeenCalledWith("account-1");
    expect(reserveReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "account-1", eventId: "event-1" }),
    );
    upsert.mockRestore();
  });

  it("Webhook Queueが未設定でもreceipt予約を継続し、同一AccountのID解決を集約する", async () => {
    const reserveReceipt = vi.fn().mockResolvedValue({ accepted: true });
    const coordinator = {
      getByName: vi.fn(() => ({ reserveReceipt })),
    } as unknown as ConversationCoordinatorNamespace;
    const upsert = vi.spyOn(d1.action.account, "upsertIdentity").mockResolvedValue({
      account: { id: "account-1" },
    } as Awaited<ReturnType<typeof d1.action.account.upsertIdentity>>);
    const timestamp = new Date("2026-08-07T00:00:00Z").getTime();
    const body = JSON.stringify({
      events: [
        { ...textEvent("一通目"), webhookEventId: "event-1", timestamp },
        {
          ...textEvent("二通目"),
          message: { type: "text", id: "message-2", text: "二通目" },
          webhookEventId: "event-2",
          timestamp: timestamp + 500,
        },
      ],
    });
    let reservation: Promise<unknown> | undefined;

    await expect(
      receiveLineWebhook({
        rawBody: body,
        signature: sign(body),
        channelSecret: CHANNEL_SECRET,
        queue: undefined,
        db: {} as d1.Client,
        coordinator,
        waitUntil: (promise) => {
          reservation = promise;
        },
      }),
    ).resolves.toMatchObject({ type: "accepted", queued: false });
    await reservation;

    expect(upsert).toHaveBeenCalledOnce();
    expect(coordinator.getByName).toHaveBeenCalledOnce();
    expect(reserveReceipt).toHaveBeenCalledTimes(2);
    expect(reserveReceipt).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-1" }));
    expect(reserveReceipt).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-2" }));
    upsert.mockRestore();
  });
});

describe("removeDiaryReplyTokens", () => {
  it("eventの他の値を保ったままreplyTokenだけを除く", () => {
    expect(removeDiaryReplyTokens({ events: [textEvent("本文")] })).toEqual({
      events: [
        expect.objectContaining({
          type: "message",
          message: expect.objectContaining({ text: "本文" }),
        }),
      ],
    });
  });

  it("診断commandの同期返信用replyTokenは保つ", () => {
    expect(removeDiaryReplyTokens({ events: [textEvent("診断")] })).toEqual({
      events: [expect.objectContaining({ replyToken: "reply-token" })],
    });
  });
});
