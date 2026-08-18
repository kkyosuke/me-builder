import type { AccountDataNamespace, D1 } from "@me-builder/lib";
import type { ProfileSummaryGenerationQueueMessage, Queue } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestProfileSummaryGeneration } from "./profile-summary-generation";

const execute = vi.fn();
const accountData = {
  getByName: vi.fn(() => ({ execute })),
} as unknown as AccountDataNamespace;
const send = vi.fn();
const queue = { send } as unknown as Queue<ProfileSummaryGenerationQueueMessage>;
let generationRequest: unknown;
const actor = {
  accountId: "account-1",
  authenticationMethod: "liff" as const,
  authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
};

describe("requestProfileSummaryGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generationRequest = undefined;
    execute.mockImplementation(async (_accountId: string, operation: string) => {
      if (operation === "profileSummary.requestGeneration") return generationRequest;
      return undefined;
    });
  });

  it("新しい要求を保存して本文を含まないQueue messageを送る", async () => {
    generationRequest = {
      outcome: "created",
      generationId: "generation-1",
      status: "queued",
      needsDispatch: true,
    };

    await expect(
      requestProfileSummaryGeneration({
        actor,
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
    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "profileSummary.requestGeneration",
      expect.any(Date),
    );
    expect(execute).toHaveBeenLastCalledWith(
      "account-1",
      "profileSummary.markGenerationDispatched",
      "generation-1",
      expect.any(Date),
    );
  });

  it("処理中の要求があればQueueへ重複送信しない", async () => {
    generationRequest = {
      outcome: "existing",
      generationId: "generation-1",
      status: "generating",
      needsDispatch: false,
    };

    await expect(
      requestProfileSummaryGeneration({
        actor,
        db: {} as D1.shared.Client,
        accountData,
        queue,
      }),
    ).resolves.toMatchObject({ status: "generating", created: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("AccountDataの再生成不可理由をQueueへ送らず返す", async () => {
    generationRequest = {
      outcome: "unavailable",
      reason: "regeneration_not_required",
    };

    await expect(
      requestProfileSummaryGeneration({
        actor,
        db: {} as D1.shared.Client,
        accountData,
        queue,
      }),
    ).resolves.toEqual({ type: "unavailable", reason: "regeneration_not_required" });
    expect(send).not.toHaveBeenCalled();
  });

  it("Queue送信に失敗しても要求をqueuedに保ちAlarmで復旧できる", async () => {
    generationRequest = {
      outcome: "created",
      generationId: "generation-1",
      status: "queued",
      needsDispatch: true,
    };
    send.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(
      requestProfileSummaryGeneration({
        actor,
        db: {} as D1.shared.Client,
        accountData,
        queue,
      }),
    ).resolves.toMatchObject({ type: "accepted", status: "queued" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("未配送の既存要求を同じgeneration IDでQueueへ再送する", async () => {
    generationRequest = {
      outcome: "existing",
      generationId: "generation-1",
      status: "queued",
      needsDispatch: true,
    };

    await requestProfileSummaryGeneration({
      actor,
      db: {} as D1.shared.Client,
      accountData,
      queue,
    });

    expect(send).toHaveBeenCalledWith({
      type: "profile-summary-generation",
      accountId: "account-1",
      generationId: "generation-1",
    });
  });
});
