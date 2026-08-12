import type { AccountDataNamespace, CompatibilityDataNamespace, D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { acceptCompatibilityInvitation } from "./compatibility-invitation-acceptance";

const relationshipId = "1".repeat(64);
const db = {} as D1.shared.Client;
const accountData = {} as AccountDataNamespace;
const compatibilityData = {} as CompatibilityDataNamespace;

function params(overrides: Record<string, unknown> = {}) {
  return {
    relationshipId,
    idToken: "id-token",
    lineLoginChannelId: "1234567890",
    db,
    accountData,
    compatibilityData,
    ...overrides,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const base = {
    createSession: vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-b", displayName: " 受信者 ", role: "user" },
    }),
    acceptInvitation: vi.fn().mockResolvedValue({
      outcome: "accepted",
      relationship: {},
    }),
  };
  return { ...base, ...overrides } as typeof base;
}

describe("acceptCompatibilityInvitation", () => {
  it("本人セッションから承諾入力を作り、表示用プレビューを介さず正本を更新する", async () => {
    const deps = dependencies();

    await expect(acceptCompatibilityInvitation(params(), deps)).resolves.toEqual({
      type: "accepted",
      relationshipId,
    });
    expect(deps.createSession).toHaveBeenCalledWith({
      idToken: "id-token",
      lineLoginChannelId: "1234567890",
      db,
    });
    expect(deps.acceptInvitation).toHaveBeenCalledWith(
      accountData,
      compatibilityData,
      relationshipId,
      { inviteeAccountId: "account-b", inviteeDisplayName: "受信者" },
    );
  });

  it("同じ承諾の再試行も成立として返す", async () => {
    const deps = dependencies({
      acceptInvitation: vi.fn().mockResolvedValue({ outcome: "unchanged", relationship: {} }),
    });

    await expect(acceptCompatibilityInvitation(params(), deps)).resolves.toEqual({
      type: "accepted",
      relationshipId,
    });
  });

  it("不正な関係IDは本人確認や正本更新より前に拒否する", async () => {
    const deps = dependencies();

    await expect(
      acceptCompatibilityInvitation(params({ relationshipId: "invalid" }), deps),
    ).resolves.toEqual({ type: "unavailable" });
    expect(deps.createSession).not.toHaveBeenCalled();
    expect(deps.acceptInvitation).not.toHaveBeenCalled();
  });

  it("表示名を確認できなければ正本を更新しない", async () => {
    const deps = dependencies({
      createSession: vi.fn().mockResolvedValue({
        type: "resolved",
        session: { accountId: "account-b", role: "user" },
      }),
    });

    await expect(acceptCompatibilityInvitation(params(), deps)).resolves.toEqual({
      type: "share-unavailable",
    });
    expect(deps.acceptInvitation).not.toHaveBeenCalled();
  });

  it.each([
    [{ type: "unavailable" }],
    [{ type: "unauthenticated", reason: "invalid token" }],
    [{ type: "account-not-found" }],
    [{ type: "not-configured" }],
  ])("本人セッションを解決できなければ結果をそのまま返す (%o)", async (outcome) => {
    const deps = dependencies({ createSession: vi.fn().mockResolvedValue(outcome) });

    await expect(acceptCompatibilityInvitation(params(), deps)).resolves.toEqual(outcome);
    expect(deps.acceptInvitation).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate", "duplicate-relationship"],
    ["self-invite", "own-invitation"],
    ["expired", "unavailable"],
    ["unavailable", "unavailable"],
    ["unreserved", "unavailable"],
  ] as const)("正本の%sを%sへ変換する", async (outcome, expectedType) => {
    const deps = dependencies({
      acceptInvitation: vi.fn().mockResolvedValue({ outcome }),
    });

    await expect(acceptCompatibilityInvitation(params(), deps)).resolves.toEqual({
      type: expectedType,
    });
  });
});
