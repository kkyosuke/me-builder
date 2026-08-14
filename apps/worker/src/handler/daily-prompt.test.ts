import { D1, line } from "@me-builder/lib";
import { type DailyPromptQueueMessage, type Message, logger } from "@me-builder/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkerConfig } from "../config";
import type { CloudflareBindings } from "../config/cloudflare";
import { processDailyPromptMessage } from "./daily-prompt";

const execute = vi.fn();
const pushMessage = vi.fn();

function createMessage(attempts = 1): Message<DailyPromptQueueMessage> {
  return {
    id: "queue-message-1",
    attempts,
    timestamp: new Date("2026-08-14T09:00:00.000Z"),
    body: { type: "daily-prompt", accountId: "account-1", localDate: "2026-08-14" },
    ack: vi.fn(),
    retry: vi.fn(),
  } as unknown as Message<DailyPromptQueueMessage>;
}

function bindings(): CloudflareBindings {
  return {
    d1: {} as D1.shared.Client,
    do: {
      conversation: undefined,
      accountData: {
        getByName: vi.fn(() => ({ execute })),
      },
    },
    queue: { chatTurn: undefined, brainCheckpoint: undefined },
  } as unknown as CloudflareBindings;
}

const config = getWorkerConfig({
  ENVIRONMENT: "test",
  LINE_CHANNEL_ACCESS_TOKEN: "line-token",
  CHAT_DELIVERY_SECRET: "delivery-secret",
});

describe("daily prompt queue consumer", () => {
  beforeEach(() => {
    execute
      .mockReset()
      .mockImplementation(async (accountId: string, operation: string, ...args: unknown[]) => {
        if (accountId !== "account-1") throw new Error("Unexpected account");
        if (operation === "brain.selectDailyPromptWeekdayContext") return undefined;
        if (operation === "conversation.prepareDailyPrompt") {
          const input = args[0] as { promptVersion: string };
          return {
            type: "ready",
            deliveryId: "daily-prompt:2026-08-14",
            promptVersion: input.promptVersion,
          };
        }
        if (operation === "conversation.markDailyPromptDelivered") return true;
        if (operation === "conversation.markDailyPromptFailed") return true;
        throw new Error(`Unexpected operation: ${operation}`);
      });
    pushMessage.mockReset().mockResolvedValue({});
    vi.spyOn(line.client, "create").mockReturnValue({
      pushMessage,
    } as unknown as ReturnType<typeof line.client.create>);
    vi.spyOn(D1.shared.action.account, "findLineIdentityByAccountId").mockResolvedValue("U_line");
  });

  afterEach(() => vi.restoreAllMocks());

  it("配送日の曜日別文面をretry key付きで1回Pushして配送済みにする", async () => {
    const message = createMessage();
    await processDailyPromptMessage(message, bindings(), config);

    expect(execute).toHaveBeenCalledWith("account-1", "conversation.prepareDailyPrompt", {
      localDate: "2026-08-14",
      promptVersion: "daily-check-in-fri-v1",
    });
    expect(pushMessage).toHaveBeenCalledWith(
      {
        to: "U_line",
        messages: [
          {
            type: "text",
            text: "今日、少しでも話しておきたいことはある？",
          },
        ],
      },
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "conversation.markDailyPromptDelivered",
      "daily-prompt:2026-08-14",
    );
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("保存済みの曜日文脈に対応する定型文をPushする", async () => {
    execute.mockResolvedValueOnce("day_off");
    const message = createMessage();

    await processDailyPromptMessage(message, bindings(), config);

    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "brain.selectDailyPromptWeekdayContext",
      "friday",
    );
    expect(execute).toHaveBeenCalledWith("account-1", "conversation.prepareDailyPrompt", {
      localDate: "2026-08-14",
      promptVersion: "daily-check-in-day-off-v1",
    });
    expect(pushMessage).toHaveBeenCalledWith(
      {
        to: "U_line",
        messages: [
          {
            type: "text",
            text: "今日は、普段だとお休みの日だったかな。\n違っていたら気にせず、今日のことを話したいところから聞かせて。",
          },
        ],
      },
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });

  it("曜日文脈の取得に失敗しても曜日別一般文面へ戻す", async () => {
    execute.mockRejectedValueOnce(new Error("AccountData unavailable"));
    const message = createMessage();

    await processDailyPromptMessage(message, bindings(), config);

    expect(execute).toHaveBeenCalledWith("account-1", "conversation.prepareDailyPrompt", {
      localDate: "2026-08-14",
      promptVersion: "daily-check-in-fri-v1",
    });
    expect(pushMessage).toHaveBeenCalledOnce();
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("曜日文脈の取得失敗時も既存配送に固定された個別化文面を再配送する", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    execute.mockRejectedValueOnce(new Error("AccountData unavailable")).mockResolvedValueOnce({
      type: "ready",
      deliveryId: "daily-prompt:2026-08-14",
      promptVersion: "daily-check-in-day-off-v1",
    });
    const message = createMessage();

    await processDailyPromptMessage(message, bindings(), config);

    expect(pushMessage).toHaveBeenCalledWith(
      {
        to: "U_line",
        messages: [
          {
            type: "text",
            text: "今日は、普段だとお休みの日だったかな。\n違っていたら気にせず、今日のことを話したいところから聞かせて。",
          },
        ],
      },
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "daily-prompt.weekday-context.failed",
        outcome: "degraded",
        disposition: "continue",
      }),
      "[Daily prompt] failed at daily-prompt.context -> continue without newly selected weekday context",
    );
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("既存配送に固定された段階1の文面versionを再配送でも使う", async () => {
    execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      type: "ready",
      deliveryId: "daily-prompt:2026-08-14",
      promptVersion: "daily-check-in-v1",
    });
    const message = createMessage();

    await processDailyPromptMessage(message, bindings(), config);

    expect(pushMessage).toHaveBeenCalledWith(
      {
        to: "U_line",
        messages: [
          {
            type: "text",
            text: "今日はどうだった？\n短いひとことでも、まとまっていなくても大丈夫だよ。",
          },
        ],
      },
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("AccountDataがskipした日はLINEを呼ばずackする", async () => {
    execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      type: "not-ready",
      status: "skipped",
      reason: "recent_unanswered",
    });
    const message = createMessage();

    await processDailyPromptMessage(message, bindings(), config);

    expect(pushMessage).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("LINEの一時障害は同じQueue messageをretryする", async () => {
    pushMessage.mockRejectedValueOnce(new Error("network unavailable"));
    const message = createMessage();

    await processDailyPromptMessage(message, bindings(), config);

    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalledWith(
      "account-1",
      "conversation.markDailyPromptDelivered",
      expect.anything(),
    );
  });

  it("LINEが4xxで拒否した配送をfailedにして再試行しない", async () => {
    pushMessage.mockRejectedValueOnce({ status: 400 });
    const message = createMessage();

    await processDailyPromptMessage(message, bindings(), config);

    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "conversation.markDailyPromptFailed",
      "daily-prompt:2026-08-14",
      "line.push",
    );
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });
});
