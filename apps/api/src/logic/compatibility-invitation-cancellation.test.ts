import type { AccountDataNamespace, CompatibilityDataNamespace } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cancelCompatibilityInvitationWithReference } = vi.hoisted(() => ({
  cancelCompatibilityInvitationWithReference: vi.fn(),
}));
vi.mock("@me-builder/lib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@me-builder/lib")>()),
  cancelCompatibilityInvitationWithReference,
}));

const { cancelCompatibilityInvitation } = await import("./compatibility-invitation-cancellation");

const relationshipId = "1".repeat(64);
const accountId = "account-1";
const accountData = {} as AccountDataNamespace;
const compatibilityData = {} as CompatibilityDataNamespace;

function request(overrides: { relationshipId?: string } = {}) {
  return cancelCompatibilityInvitation({
    relationshipId: overrides.relationshipId ?? relationshipId,
    actor: {
      accountId,
      authenticationMethod: "liff",
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
    },
    accountData,
    compatibilityData,
  });
}

describe("cancelCompatibilityInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("本人の招待を取り消し、正本と一覧参照の更新を本人IDで実行する", async () => {
    cancelCompatibilityInvitationWithReference.mockResolvedValue({ outcome: "cancelled" });

    await expect(request()).resolves.toEqual({ type: "cancelled" });
    expect(cancelCompatibilityInvitationWithReference).toHaveBeenCalledWith(
      accountData,
      compatibilityData,
      relationshipId,
      accountId,
    );
  });

  it("取消済みの再試行も成功として返す", async () => {
    cancelCompatibilityInvitationWithReference.mockResolvedValue({ outcome: "unchanged" });

    await expect(request()).resolves.toEqual({ type: "cancelled" });
  });

  it.each([["forbidden"], ["unavailable"]] as const)(
    "正本が%sなら取消できないことだけを伝える",
    async (outcome) => {
      cancelCompatibilityInvitationWithReference.mockResolvedValue({ outcome });

      await expect(request()).resolves.toEqual({ type: "unavailable" });
    },
  );

  it("関係IDの形式が不正なら正本へ触れずunavailableを返す", async () => {
    await expect(request({ relationshipId: "not-a-relationship" })).resolves.toEqual({
      type: "unavailable",
    });
    expect(cancelCompatibilityInvitationWithReference).not.toHaveBeenCalled();
  });
});
