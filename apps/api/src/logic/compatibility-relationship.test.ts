import type { AccountDataNamespace, CompatibilityDataNamespace, D1 } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCompatibilityRelationshipContents } from "./compatibility-relationship";

const mocks = vi.hoisted(() => ({
  createLiffSession: vi.fn(),
  getRelationship: vi.fn(),
  synchronizeProgression: vi.fn(),
  loadSharePreviewData: vi.fn(),
}));

vi.mock("./liff-session", () => ({ createLiffSession: mocks.createLiffSession }));
vi.mock("@me-builder/lib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@me-builder/lib")>()),
  compatibilityDataFor: () => ({
    getRelationship: mocks.getRelationship,
    synchronizeProgression: mocks.synchronizeProgression,
  }),
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

function theme(diagnosisId: string, scoringVersion = 1) {
  return {
    diagnosisId,
    title: diagnosisId,
    scoringConfigId: `${diagnosisId}-config`,
    scoringVersion,
    parameters: [
      {
        id: "planning",
        label: "予定",
        lowLabel: "その場",
        highLabel: "早め",
        position: 80,
        statement: "「早め」傾向があります",
        band: "high" as const,
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
    mocks.synchronizeProgression.mockResolvedValue({
      level: 2,
      growthValue: 3,
      currentLevelThreshold: 3,
      nextLevelThreshold: 12,
      comparableThemeCount: 1,
      marks: [2],
    });
  });

  it("双方が表示できる共通テーマから、相手を先にした相性シートを組み立てる", async () => {
    mocks.loadSharePreviewData
      .mockResolvedValueOnce(
        shareData({ displayName: "あおい", themes: [theme("shared"), theme("only-inviter")] }),
      )
      .mockResolvedValueOnce(
        shareData({ displayName: "はる", themes: [theme("shared"), theme("only-invitee")] }),
      );

    await expect(getCompatibilityRelationshipContents(params)).resolves.toMatchObject({
      type: "resolved",
      relationship: {
        relationshipCategory: "friend",
        status: "ready",
        partner: { displayName: "はる", themes: [{ diagnosisId: "shared" }] },
        viewer: { displayName: "あおい", themes: [{ diagnosisId: "shared" }] },
        unavailableThemes: [
          { diagnosisId: "only-inviter", title: "only-inviter" },
          { diagnosisId: "only-invitee", title: "only-invitee" },
        ],
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
    expect(mocks.synchronizeProgression).toHaveBeenCalledWith("account-inviter", [
      { diagnosisId: "shared", fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });

  it("ふたり進行度の同期だけが失敗しても相性シートを返す", async () => {
    mocks.loadSharePreviewData
      .mockResolvedValueOnce(shareData({ displayName: "あおい", themes: [theme("shared")] }))
      .mockResolvedValueOnce(shareData({ displayName: "はる", themes: [theme("shared")] }));
    mocks.synchronizeProgression.mockRejectedValue(new Error("progression unavailable"));

    await expect(getCompatibilityRelationshipContents(params)).resolves.toMatchObject({
      type: "resolved",
      relationship: {
        status: "ready",
        partner: { displayName: "はる" },
        viewer: { displayName: "あおい" },
        progression: null,
      },
    });
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

  it("同じ診断でも採点設定版が異なるテーマは比較に使わない", async () => {
    mocks.loadSharePreviewData
      .mockResolvedValueOnce(
        shareData({
          displayName: "あおい",
          themes: [theme("shared"), theme("versioned", 1)],
        }),
      )
      .mockResolvedValueOnce(
        shareData({
          displayName: "はる",
          themes: [theme("shared"), theme("versioned", 2)],
        }),
      );

    await expect(getCompatibilityRelationshipContents(params)).resolves.toMatchObject({
      type: "resolved",
      relationship: {
        status: "ready",
        partner: { themes: [{ diagnosisId: "shared" }] },
        viewer: { themes: [{ diagnosisId: "shared" }] },
        unavailableThemes: [{ diagnosisId: "versioned", title: "versioned" }],
      },
    });
  });

  it("採点設定版の不一致だけで比較できない場合は、本人へ不要な操作を案内しない", async () => {
    mocks.loadSharePreviewData
      .mockResolvedValueOnce(
        shareData({
          displayName: "あおい",
          hasAnswerableDiagnosis: false,
          themes: [theme("versioned", 1)],
        }),
      )
      .mockResolvedValueOnce(
        shareData({
          displayName: "はる",
          hasAnswerableDiagnosis: false,
          themes: [theme("versioned", 2)],
        }),
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
