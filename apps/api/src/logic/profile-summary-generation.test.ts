import type { AccountDataNamespace, D1 } from "@me-builder/lib";
import type { ProfileSummaryGenerationQueueMessage, Queue } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestProfileSummaryGeneration } from "./profile-summary-generation";

const { createLiffSession } = vi.hoisted(() => ({ createLiffSession: vi.fn() }));
vi.mock("./liff-session", () => ({ createLiffSession }));

const execute = vi.fn();
const accountData = {
  getByName: vi.fn(() => ({ execute })),
} as unknown as AccountDataNamespace;
const send = vi.fn();
const queue = { send } as unknown as Queue<ProfileSummaryGenerationQueueMessage>;

describe("requestProfileSummaryGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLiffSession.mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user" },
    });
  });

  it("新しい要求を保存して本文を含まないQueue messageを送る", async () => {
    execute.mockResolvedValueOnce({
      outcome: "created",
      generationId: "generation-1",
      status: "queued",
    });

    await expect(
      requestProfileSummaryGeneration({
        idToken: "token",
        lineLoginChannelId: "channel",
        db: {} as D1.shared.Client,
        accountData,
        queue,
      }),
    ).resolves.toMatchObject({ type: "accepted", generationId: "generation-1", created: true });
    expect(send).toHaveBeenCalledWith({
      type: "profile-summary-generation",
      accountId: "account-1",
      generationId: "generation-1",
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain("本文");
  });

  it("処理中の要求があればQueueへ重複送信しない", async () => {
    execute.mockResolvedValueOnce({
      outcome: "existing",
      generationId: "generation-1",
      status: "generating",
    });

    await expect(
      requestProfileSummaryGeneration({
        idToken: "token",
        lineLoginChannelId: "channel",
        db: {} as D1.shared.Client,
        accountData,
        queue,
      }),
    ).resolves.toMatchObject({ status: "generating", created: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("開発環境の無変更再生成許可をAccountDataへ渡す", async () => {
    execute.mockResolvedValueOnce({
      outcome: "created",
      generationId: "generation-dev",
      status: "queued",
    });

    await requestProfileSummaryGeneration({
      idToken: "token",
      lineLoginChannelId: "channel",
      db: {} as D1.shared.Client,
      accountData,
      queue,
      at: new Date("2026-08-11T00:00:00.000Z"),
      allowUnchangedRegeneration: true,
    });

    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "profileSummary.requestGeneration",
      new Date("2026-08-11T00:00:00.000Z"),
      true,
    );
  });

  it("AccountDataの再生成不可理由をQueueへ送らず返す", async () => {
    execute.mockResolvedValueOnce({
      outcome: "unavailable",
      reason: "regeneration_not_required",
    });

    await expect(
      requestProfileSummaryGeneration({
        idToken: "token",
        lineLoginChannelId: "channel",
        db: {} as D1.shared.Client,
        accountData,
        queue,
      }),
    ).resolves.toEqual({ type: "unavailable", reason: "regeneration_not_required" });
    expect(send).not.toHaveBeenCalled();
  });

  it("Queue送信に失敗した要求をfailedへ遷移する", async () => {
    execute.mockResolvedValueOnce({
      outcome: "created",
      generationId: "generation-1",
      status: "queued",
    });
    send.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(
      requestProfileSummaryGeneration({
        idToken: "token",
        lineLoginChannelId: "channel",
        db: {} as D1.shared.Client,
        accountData,
        queue,
      }),
    ).rejects.toThrow("queue unavailable");
    expect(execute).toHaveBeenLastCalledWith(
      "account-1",
      "profileSummary.failGeneration",
      "generation-1",
      expect.any(String),
    );
  });
});
