import type { AccountDataNamespace, AccountDataOperation, d1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { deleteAvatar, selectAvatar } from "./avatar";

function accountData(
  execute: (operation: AccountDataOperation, ...args: unknown[]) => Promise<unknown>,
): AccountDataNamespace {
  return {
    getByName: () => ({
      execute: (_accountId: string, operation: AccountDataOperation, ...args: unknown[]) =>
        execute(operation, ...args),
    }),
  } as unknown as AccountDataNamespace;
}

const dependencies = {
  createSession: vi.fn(async () => ({
    type: "resolved" as const,
    session: { accountId: "account-1", role: "user" as const },
  })),
  normalizeImage: vi.fn(async () => ({
    bytes: new Uint8Array(),
    contentType: "image/webp" as const,
  })),
  createId: () => "id",
};

const baseParams = {
  idToken: "token",
  lineLoginChannelId: "channel",
  avatarChangeIntervalMs: 0,
  db: {} as d1.Client,
};

describe("avatar logic", () => {
  it("選択後の物理削除を待たず、AccountDataへ記録した状態を成功として返す", async () => {
    const at = new Date("2026-08-09T00:00:00.000Z");
    const candidate = {
      id: "candidate-1",
      jobId: "job-1",
      objectKey: "candidate.webp",
      contentType: "image/webp",
      createdAt: at,
      expiresAt: new Date("2026-08-16T00:00:00.000Z"),
      selectedAt: at,
    };
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation !== "avatar.selectCandidate") throw new Error("Unexpected operation");
      return {
        type: "selected",
        previousObjectKey: "previous.webp",
        state: {
          currentCandidate: candidate,
          latestJob: {
            id: "job-1",
            status: "selected",
            referenceObjectKey: "reference.webp",
            referenceContentType: "image/webp",
            pendingOperation: null,
            queuePending: false,
            nextEnqueueAt: null,
            enqueueAttemptCount: 0,
            processingLeaseExpiresAt: null,
            attemptCount: 1,
            errorCode: null,
            model: "model",
            createdAt: at,
            updatedAt: at,
            expiresAt: candidate.expiresAt,
            candidates: [candidate],
          },
        },
      };
    });

    await expect(
      selectAvatar(
        { ...baseParams, accountData: accountData(execute), candidateId: candidate.id },
        dependencies,
      ),
    ).resolves.toMatchObject({
      type: "selected",
      state: { currentAvatar: { id: candidate.id } },
    });
  });

  it("現在値の削除はR2 bindingなしでdurable outboxへ委譲できる", async () => {
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation !== "avatar.deleteCurrent") throw new Error("Unexpected operation");
      return { type: "deleted", previousObjectKey: "previous.webp" };
    });

    await expect(
      deleteAvatar({ ...baseParams, accountData: accountData(execute) }, dependencies),
    ).resolves.toEqual({ type: "deleted" });
  });

  it.each([
    ["avatar.selectCandidate", "candidate-1"],
    ["avatar.deleteCurrent", undefined],
  ] as const)("%sの変更間隔制限を次回変更可能日時へ変換する", async (operation, candidateId) => {
    const retryAt = new Date("2026-08-16T00:00:00.000Z");
    const execute = vi.fn(async (actualOperation: AccountDataOperation) => {
      if (actualOperation !== operation) throw new Error("Unexpected operation");
      return { type: "rate-limited", retryAt };
    });
    const params = {
      ...baseParams,
      avatarChangeIntervalMs: 7 * 24 * 60 * 60 * 1000,
      accountData: accountData(execute),
    };

    const result = candidateId
      ? await selectAvatar({ ...params, candidateId }, dependencies)
      : await deleteAvatar(params, dependencies);

    expect(result).toEqual({ type: "rate-limited", retryAt: retryAt.toISOString() });
  });
});
