import type { AccountDataNamespace, CompatibilityDataNamespace, D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getCompatibilityInvitationContents } from "./compatibility-invitation-preview";

const relationshipId = "1".repeat(64);
const accountData = {} as AccountDataNamespace;
const compatibilityData = {} as CompatibilityDataNamespace;
const db = {} as D1.shared.Client;
const expiresAt = new Date("2026-08-26T00:00:00.000Z");
const previewToken = `csp2.${"a".repeat(64)}`;
const offeredProfile = {
  profileSummaryVersionId: "profile-inviter",
  fingerprint: "b".repeat(64),
};
const offeredTheme = { diagnosisId: "diagnosis-1", resultFingerprint: "c".repeat(64) };
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
const aboutMe = {
  profileSummaryVersionId: "profile-inviter",
  generatedAt: "2026-08-11T00:00:00.000Z",
  statements: [{ key: "planning", label: "予定", statement: "私は見通しを大切にします" }],
};

function previewData({
  displayName,
  profile = offeredProfile,
  themes = [theme],
  blockingReasons = [],
}: {
  displayName: string | null;
  profile?: typeof offeredProfile | null;
  themes?: readonly (typeof theme)[];
  blockingReasons?: readonly ("diagnosis_required" | "profile_summary_required")[];
}) {
  return {
    displayName,
    shareProfile: profile
      ? {
          ...profile,
          generatedAt: "2026-08-11T00:00:00.000Z",
          statements: aboutMe.statements,
        }
      : null,
    shareableDiagnoses: themes.map((item) => ({
      diagnosisId: item.diagnosisId,
      title: item.title,
      scoringConfigId: "scoring-1",
      scoring: {
        scoringVersion: 1,
        balancedLabel: "状況による",
        parameters: [],
      },
    })),
    preview: {
      displayName,
      previewToken,
      aboutMe: profile
        ? { ...aboutMe, profileSummaryVersionId: profile.profileSummaryVersionId }
        : null,
      themes,
      canIssueInvitation: blockingReasons.length === 0,
      blockingReasons,
      nextAction: blockingReasons.includes("profile_summary_required")
        ? ("profile-summary" as const)
        : blockingReasons.includes("diagnosis_required")
          ? ("diagnosis" as const)
          : null,
    },
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
      offeredDiagnosisIds: ["diagnosis-1"],
      expiresAt,
      isOwnInvitation: false,
    }),
    getInvitationContext: vi.fn().mockResolvedValue({
      inviterAccountId: "account-inviter",
      offeredProfile,
      offeredThemes: [offeredTheme],
      offeredDiagnosisIds: ["diagnosis-1"],
      expiresAt,
    }),
    loadSharePreviewData: vi
      .fn()
      .mockResolvedValueOnce(previewData({ displayName: "あおい" }))
      .mockResolvedValueOnce(
        previewData({
          displayName: "はる",
          profile: { profileSummaryVersionId: "profile-recipient", fingerprint: "d".repeat(64) },
        }),
      ),
    createThemeFingerprints: vi.fn().mockResolvedValue([offeredTheme]),
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
  it("同意済み送信者snapshotと受信者の共通テーマを保存せず返す", async () => {
    const deps = dependencies();

    await expect(getCompatibilityInvitationContents(params(), deps)).resolves.toEqual({
      type: "resolved",
      invitation: {
        inviter: {
          displayName: "あおい",
          avatarUrl: `/api/compatibility/invitations/${relationshipId}/avatar`,
          aboutMe,
          themes: [theme],
        },
        recipient: {
          displayName: "はる",
          avatarUrl: "/api/profile/avatar",
          previewToken,
          aboutMe: { ...aboutMe, profileSummaryVersionId: "profile-recipient" },
          themes: [theme],
        },
        expiresAt: expiresAt.toISOString(),
        canAccept: true,
        blockingReasons: [],
        nextAction: null,
      },
    });
    expect(deps.loadSharePreviewData).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accountId: "account-inviter",
        profileSummaryVersionId: "profile-inviter",
      }),
    );
  });

  it("共通テーマがなければ診断へ案内し承諾不可にする", async () => {
    const deps = dependencies({
      loadSharePreviewData: vi
        .fn()
        .mockResolvedValueOnce(previewData({ displayName: "あおい" }))
        .mockResolvedValueOnce(previewData({ displayName: "はる", themes: [] })),
    });

    await expect(getCompatibilityInvitationContents(params(), deps)).resolves.toMatchObject({
      type: "resolved",
      invitation: {
        recipient: { themes: [] },
        canAccept: false,
        blockingReasons: ["common_diagnosis_required"],
        nextAction: "diagnosis",
      },
    });
  });

  it("送信者の同意指紋と現在内容が異なれば内容を開示しない", async () => {
    const deps = dependencies({
      createThemeFingerprints: vi
        .fn()
        .mockResolvedValue([{ diagnosisId: "diagnosis-1", resultFingerprint: "e".repeat(64) }]),
    });

    await expect(getCompatibilityInvitationContents(params(), deps)).resolves.toEqual({
      type: "unavailable",
    });
  });

  it("自分の招待を承諾画面へ進めない", async () => {
    const deps = dependencies({
      getInvitationPreview: vi.fn().mockResolvedValue({
        id: relationshipId,
        inviterDisplayName: "あおい",
        offeredDiagnosisIds: ["diagnosis-1"],
        expiresAt,
        isOwnInvitation: true,
      }),
    });

    await expect(getCompatibilityInvitationContents(params(), deps)).resolves.toEqual({
      type: "own-invitation",
    });
    expect(deps.getInvitationContext).not.toHaveBeenCalled();
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
