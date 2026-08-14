import type { AccountDataNamespace, CompatibilityDataNamespace, D1 } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCompatibilityRelationshipContents } from "./compatibility-relationship";

const mocks = vi.hoisted(() => ({
  createLiffSession: vi.fn(),
  getRelationship: vi.fn(),
  loadSharePreviewData: vi.fn(),
}));

vi.mock("./liff-session", () => ({ createLiffSession: mocks.createLiffSession }));
vi.mock("@me-builder/lib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@me-builder/lib")>()),
  compatibilityDataFor: () => ({ getRelationship: mocks.getRelationship }),
}));
vi.mock("./compatibility-share-preview", () => ({
  loadCompatibilitySharePreviewData: mocks.loadSharePreviewData,
}));

const relationshipId = "1".repeat(64);
const params = {
  relationshipId,
  idToken: "id-token",
  lineLoginChannelId: "channel-id",
  db: {} as D1.shared.Client,
  accountData: {} as AccountDataNamespace,
  compatibilityData: {} as CompatibilityDataNamespace,
  at: new Date("2026-08-13T00:00:00.000Z"),
};

function theme(diagnosisId: string) {
  return {
    diagnosisId,
    title: diagnosisId,
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
}

function shareData({
  displayName,
  hasProfile = true,
  hasAnswerableDiagnosis = true,
  themes,
}: {
  displayName: string;
  hasProfile?: boolean;
  hasAnswerableDiagnosis?: boolean;
  themes: ReturnType<typeof theme>[];
}) {
  return {
    displayName,
    aboutMe: hasProfile
      ? {
          profileSummaryVersionId: `profile-${displayName}`,
          generatedAt: "2026-08-12T00:00:00.000Z",
          statements: [{ key: "planning", label: "予定", statement: "私は見通しを大切にします" }],
        }
      : null,
    themes,
    hasAnswerableDiagnosis,
    nextAction: hasProfile ? null : ("profile-summary" as const),
  };
}

describe("getCompatibilityRelationshipContents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createLiffSession.mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-inviter", role: "user", displayName: "あおい" },
    });
    mocks.getRelationship.mockResolvedValue({
      id: relationshipId,
      inviterAccountId: "account-inviter",
      inviteeAccountId: "account-invitee",
      inviterDisplayName: "あおい",
      inviteeDisplayName: "はる",
      relationshipCategory: "friend",
      status: "accepted",
    });
  });

  it("双方が表示できる共通テーマから、相手を先にした相性シートを組み立てる", async () => {
    mocks.loadSharePreviewData
      .mockResolvedValueOnce(shareData({ displayName: "あおい", themes: [theme("shared")] }))
      .mockResolvedValueOnce(shareData({ displayName: "はる", themes: [theme("shared")] }));

    await expect(getCompatibilityRelationshipContents(params)).resolves.toMatchObject({
      type: "resolved",
      relationship: {
        relationshipCategory: "friend",
        status: "ready",
        partner: { displayName: "はる", themes: [{ diagnosisId: "shared" }] },
        viewer: { displayName: "あおい", themes: [{ diagnosisId: "shared" }] },
      },
    });
    expect(mocks.loadSharePreviewData).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ relationshipCategory: "friend" }),
    );
    expect(mocks.loadSharePreviewData).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ relationshipCategory: "friend" }),
    );
  });

  it("片方で表示できないテーマは比較に使わず、回答できる診断が残っていれば案内する", async () => {
    // 回答済みでも採点できないDiagnosisは共有表示から落ちるため、themesの共通部分で判定する。
    mocks.loadSharePreviewData
      .mockResolvedValueOnce(shareData({ displayName: "あおい", themes: [theme("shared")] }))
      .mockResolvedValueOnce(shareData({ displayName: "はる", themes: [] }));

    await expect(getCompatibilityRelationshipContents(params)).resolves.toEqual({
      type: "resolved",
      relationship: {
        relationshipId,
        relationshipCategory: "friend",
        status: "waiting",
        nextAction: "diagnosis",
      },
    });
  });

  it("閲覧者が回答し終えている場合は、共通テーマがなくても診断へ案内しない", async () => {
    mocks.loadSharePreviewData
      .mockResolvedValueOnce(
        shareData({
          displayName: "あおい",
          hasAnswerableDiagnosis: false,
          themes: [theme("only-mine")],
        }),
      )
      .mockResolvedValueOnce(shareData({ displayName: "はる", themes: [] }));

    await expect(getCompatibilityRelationshipContents(params)).resolves.toEqual({
      type: "resolved",
      relationship: {
        relationshipId,
        relationshipCategory: "friend",
        status: "waiting",
        nextAction: null,
      },
    });
  });

  it("閲覧者自身の「私について」を開示できなければ生成画面へ案内する", async () => {
    mocks.loadSharePreviewData
      .mockResolvedValueOnce(
        shareData({ displayName: "あおい", hasProfile: false, themes: [theme("shared")] }),
      )
      .mockResolvedValueOnce(shareData({ displayName: "はる", themes: [theme("shared")] }));

    await expect(getCompatibilityRelationshipContents(params)).resolves.toEqual({
      type: "resolved",
      relationship: {
        relationshipId,
        relationshipCategory: "friend",
        status: "waiting",
        nextAction: "profile-summary",
      },
    });
  });

  it("相手側の準備だけが足りない場合は案内を出さない", async () => {
    mocks.loadSharePreviewData
      .mockResolvedValueOnce(shareData({ displayName: "あおい", themes: [theme("shared")] }))
      .mockResolvedValueOnce(
        shareData({ displayName: "はる", hasProfile: false, themes: [theme("shared")] }),
      );

    await expect(getCompatibilityRelationshipContents(params)).resolves.toEqual({
      type: "resolved",
      relationship: {
        relationshipId,
        relationshipCategory: "friend",
        status: "waiting",
        nextAction: null,
      },
    });
  });

  it("終了済みなど正本から取得できない関係は利用不可として扱う", async () => {
    mocks.getRelationship.mockResolvedValue(null);

    await expect(getCompatibilityRelationshipContents(params)).resolves.toEqual({
      type: "unavailable",
    });
    expect(mocks.loadSharePreviewData).not.toHaveBeenCalled();
  });
});
