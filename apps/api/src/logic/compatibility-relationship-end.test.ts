import type { AccountDataNamespace, CompatibilityDataNamespace, D1 } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createLiffSession, endCompatibilityRelationshipWithReferences } = vi.hoisted(() => ({
  createLiffSession: vi.fn(),
  endCompatibilityRelationshipWithReferences: vi.fn(),
}));
vi.mock("./liff-session", () => ({ createLiffSession }));
vi.mock("@me-builder/lib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@me-builder/lib")>()),
  endCompatibilityRelationshipWithReferences,
}));

const { endCompatibilityRelationship } = await import("./compatibility-relationship-end");

const relationshipId = "1".repeat(64);
const accountId = "account-1";
const db = {} as D1.shared.Client;
const accountData = {} as AccountDataNamespace;
const compatibilityData = {} as CompatibilityDataNamespace;

function request(overrides: { relationshipId?: string } = {}) {
  return endCompatibilityRelationship({
    relationshipId: overrides.relationshipId ?? relationshipId,
    idToken: "token",
    lineLoginChannelId: "channel",
    db,
    accountData,
    compatibilityData,
  });
}

describe("endCompatibilityRelationship", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLiffSession.mockResolvedValue({
      type: "resolved",
      session: { accountId, role: "user", displayName: "あおい" },
    });
  });

  it("当事者として関係を終了し、正本と双方の参照更新を本人IDで実行する", async () => {
    endCompatibilityRelationshipWithReferences.mockResolvedValue({ outcome: "ended" });

    await expect(request()).resolves.toEqual({ type: "ended" });
    expect(endCompatibilityRelationshipWithReferences).toHaveBeenCalledWith(
      accountData,
      compatibilityData,
      relationshipId,
      accountId,
    );
  });

  it("終了済みの再試行も成功として返す", async () => {
    endCompatibilityRelationshipWithReferences.mockResolvedValue({ outcome: "unchanged" });

    await expect(request()).resolves.toEqual({ type: "ended" });
  });

  it.each([["not-found"], ["unavailable"]] as const)(
    "正本が%sなら関係の有無を区別せずunavailableを返す",
    async (outcome) => {
      endCompatibilityRelationshipWithReferences.mockResolvedValue({ outcome });

      await expect(request()).resolves.toEqual({ type: "unavailable" });
    },
  );

  it("関係IDの形式が不正なら正本へ触れずunavailableを返す", async () => {
    await expect(request({ relationshipId: "not-a-relationship" })).resolves.toEqual({
      type: "unavailable",
    });
    expect(endCompatibilityRelationshipWithReferences).not.toHaveBeenCalled();
  });

  it("本人確認より先に関係IDを信用しない", async () => {
    createLiffSession.mockResolvedValue({ type: "unauthenticated", reason: "invalid token" });

    await expect(request()).resolves.toEqual({ type: "unauthenticated", reason: "invalid token" });
    expect(endCompatibilityRelationshipWithReferences).not.toHaveBeenCalled();
  });

  it.each([[{ type: "account-not-found" }], [{ type: "not-configured" }]])(
    "セッション解決に失敗するとそのまま返す (%o)",
    async (session) => {
      createLiffSession.mockResolvedValue(session);

      await expect(request()).resolves.toEqual(session);
      expect(endCompatibilityRelationshipWithReferences).not.toHaveBeenCalled();
    },
  );
});
