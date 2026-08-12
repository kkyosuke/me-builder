import type { AccountDataNamespace, CompatibilityDataNamespace, D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getCompatibilityInvitationContents } from "./compatibility-invitation-preview";

const relationshipId = "1".repeat(64);
const accountData = {} as AccountDataNamespace;
const compatibilityData = {} as CompatibilityDataNamespace;
const db = {} as D1.shared.Client;
const expiresAt = new Date("2026-08-26T00:00:00.000Z");
const theme = {
  diagnosisId: "diagnosis-1",
  title: "時間と予定",
  parameters: [
    {
      id: "planning",
      label: "予定",
      lowLabel: "その場",
      highLabel: "早め",
      position: 80,
      statement: "「早め」傾向があります",
    },
  ],
};

function previewData({
  displayName,
  hasProfile = true,
  themes = [theme],
}: {
  displayName: string | null;
  hasProfile?: boolean;
  themes?: readonly (typeof theme)[];
}) {
  return {
    displayName,
    aboutMe: hasProfile
      ? {
          profileSummaryVersionId: "profile-recipient",
          generatedAt: "2026-08-11T00:00:00.000Z",
          statements: [{ key: "planning", label: "予定", statement: "私は見通しを大切にします" }],
        }
      : null,
    themes,
    hasAnswerableDiagnosis: true,
    nextAction: !hasProfile
      ? ("profile-summary" as const)
      : themes.length === 0
        ? ("diagnosis" as const)
        : null,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    createSession: vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-recipient", displayName: "はる", role: "user" },
    }),
    getInvitationPreview: vi.fn().mockResolvedValue({
      id: relationshipId,
      inviterDisplayName: "あおい",
      expiresAt,
      isOwnInvitation: false,
    }),
    loadSharePreviewData: vi.fn().mockResolvedValue(previewData({ displayName: "はる" })),
    ...overrides,
  };
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    relationshipId,
    idToken: "id-token",
    lineLoginChannelId: "channel-id",
    db,
    accountData,
    compatibilityData,
    ...overrides,
  };
}

describe("getCompatibilityInvitationContents", () => {
  it("招待者の表示名と受信者の共有可否だけを返し、双方の内容を読み込まない", async () => {
    const deps = dependencies();

    await expect(getCompatibilityInvitationContents(params(), deps)).resolves.toEqual({
      type: "resolved",
      invitation: {
        inviter: {
          displayName: "あおい",
          avatarUrl: `/api/compatibility/invitations/${relationshipId}/avatar`,
        },
        recipient: { displayName: "はる", avatarUrl: "/api/profile/avatar" },
        expiresAt: expiresAt.toISOString(),
        canAccept: true,
        blockingReasons: [],
        nextAction: null,
      },
    });
    expect(deps.loadSharePreviewData).toHaveBeenCalledOnce();
    expect(deps.loadSharePreviewData).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "account-recipient" }),
    );
  });

  it("共有できる内容がまだなくても承諾でき、次の操作だけを案内する", async () => {
    const deps = dependencies({
      loadSharePreviewData: vi
        .fn()
        .mockResolvedValue(previewData({ displayName: "はる", themes: [] })),
    });

    await expect(getCompatibilityInvitationContents(params(), deps)).resolves.toMatchObject({
      type: "resolved",
      invitation: { canAccept: true, blockingReasons: [], nextAction: "diagnosis" },
    });
  });

  it("表示名を確認できない受信者には承諾させない", async () => {
    const deps = dependencies({
      createSession: vi.fn().mockResolvedValue({
        type: "resolved",
        session: { accountId: "account-recipient", role: "user" },
      }),
      loadSharePreviewData: vi.fn().mockResolvedValue(previewData({ displayName: null })),
    });

    await expect(getCompatibilityInvitationContents(params(), deps)).resolves.toMatchObject({
      type: "resolved",
      invitation: {
        recipient: { displayName: null },
        canAccept: false,
        blockingReasons: ["display_name_unavailable"],
      },
    });
  });

  it("自分の招待を承諾画面へ進めない", async () => {
    const deps = dependencies({
      getInvitationPreview: vi.fn().mockResolvedValue({
        id: relationshipId,
        inviterDisplayName: "あおい",
        expiresAt,
        isOwnInvitation: true,
      }),
    });

    await expect(getCompatibilityInvitationContents(params(), deps)).resolves.toEqual({
      type: "own-invitation",
    });
    expect(deps.loadSharePreviewData).not.toHaveBeenCalled();
  });

  it("本人確認に失敗した場合は招待を読まない", async () => {
    const deps = dependencies({
      createSession: vi.fn().mockResolvedValue({ type: "unauthenticated", reason: "invalid" }),
    });

    await expect(getCompatibilityInvitationContents(params(), deps)).resolves.toEqual({
      type: "unauthenticated",
      reason: "invalid",
    });
    expect(deps.getInvitationPreview).not.toHaveBeenCalled();
  });

  it("不正な関係IDは本人確認後に利用不可として扱う", async () => {
    const deps = dependencies();

    await expect(
      getCompatibilityInvitationContents(params({ relationshipId: "invalid" }), deps),
    ).resolves.toEqual({ type: "unavailable" });
    expect(deps.createSession).toHaveBeenCalledOnce();
    expect(deps.getInvitationPreview).not.toHaveBeenCalled();
  });
});
