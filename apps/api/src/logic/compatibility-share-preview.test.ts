import type { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getCompatibilitySharePreview } from "./compatibility-share-preview";

const db = {} as D1.shared.Client;
const at = new Date("2026-08-09T00:00:00.000Z");
const previewToken = `csp2.${"a".repeat(64)}`;
const shareProfile = {
  profileSummaryVersionId: "summary-version-1",
  generatedAt: "2026-08-11T00:00:00.000Z",
  statements: [
    {
      key: "planning-style",
      label: "予定の立て方",
      statement: "私は、先の見通しを持って動けると安心しやすいです",
    },
  ],
  fingerprint: "b".repeat(64),
};
const availableShareProfile = { type: "available" as const, profile: shareProfile };

describe("getCompatibilitySharePreview", () => {
  it("本人の回答済みDiagnosisだけを採点し、安全な共有表示へ変換する", async () => {
    const createSession = vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user", displayName: " あおい " },
    });
    const answeredDiagnosis = {
      id: "answered",
      title: "時間と予定",
      description: "説明",
      opensAt: "2026-08-01T00:00:00.000Z",
      closesAt: null,
      displayOrder: 10,
      availability: "open",
      responseStatus: "answered",
      answeredCount: 2,
      questionCount: 2,
      lastAnsweredAt: "2026-08-08T00:00:00.000Z",
    };
    const inProgressDiagnosis = {
      id: "in-progress",
      title: "回答途中",
      description: "説明",
      opensAt: "2026-08-01T00:00:00.000Z",
      closesAt: null,
      displayOrder: 20,
      availability: "open",
      responseStatus: "in-progress",
      answeredCount: 1,
      questionCount: 2,
      lastAnsweredAt: "2026-08-08T00:00:00.000Z",
    };
    const getPreviewSource = vi.fn().mockResolvedValue({
      diagnoses: [answeredDiagnosis, inProgressDiagnosis],
      answeredDiagnoses: [
        {
          ...answeredDiagnosis,
          responseStatus: "answered",
          answers: [{ questionId: "question-1", questionVersion: 1, choiceId: "yes" }],
          scoringConfig: { id: "config-1" },
        },
      ],
    });
    const scoreAnswers = vi.fn().mockReturnValue({
      scoringVersion: 1,
      balancedLabel: "状況に応じて決めたい",
      parameters: [
        {
          id: "planning",
          label: "予定を決めるタイミング",
          lowLabel: "その場で決めたい",
          highLabel: "早めに決めたい",
          score: 78,
          coverage: 100,
          band: "high",
        },
      ],
    });

    const result = await getCompatibilitySharePreview(
      { idToken: "id-token", lineLoginChannelId: "channel-id", db, at },
      {
        createSession,
        getPreviewSource,
        getShareProfile: vi.fn().mockResolvedValue(availableShareProfile),
        scoreAnswers,
        createPreviewToken: vi.fn().mockResolvedValue(previewToken),
      },
    );

    expect(getPreviewSource).toHaveBeenCalledOnce();
    expect(getPreviewSource).toHaveBeenCalledWith(undefined, "account-1", at);
    expect(result).toEqual({
      type: "resolved",
      preview: {
        displayName: "あおい",
        previewToken,
        aboutMe: {
          profileSummaryVersionId: "summary-version-1",
          generatedAt: "2026-08-11T00:00:00.000Z",
          statements: shareProfile.statements,
        },
        themes: [
          {
            diagnosisId: "answered",
            title: "時間と予定",
            parameters: [
              {
                id: "planning",
                label: "予定を決めるタイミング",
                lowLabel: "その場で決めたい",
                highLabel: "早めに決めたい",
                position: 78,
                statement: "「早めに決めたい」傾向があります",
              },
            ],
          },
        ],
        canIssueInvitation: true,
        blockingReasons: [],
        nextAction: null,
      },
    });
  });

  it("表示名または共有可能テーマがなければ招待を発行不可にする", async () => {
    const result = await getCompatibilitySharePreview(
      { idToken: "id-token", lineLoginChannelId: "channel-id", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user" },
        }),
        getPreviewSource: vi.fn().mockResolvedValue({
          diagnoses: [],
          answeredDiagnoses: [],
        }),
        getShareProfile: vi.fn().mockResolvedValue(availableShareProfile),
        scoreAnswers: vi.fn(),
        createPreviewToken: vi.fn().mockResolvedValue(previewToken),
      },
    );

    expect(result).toEqual({
      type: "resolved",
      preview: {
        displayName: null,
        previewToken,
        aboutMe: {
          profileSummaryVersionId: "summary-version-1",
          generatedAt: "2026-08-11T00:00:00.000Z",
          statements: shareProfile.statements,
        },
        themes: [],
        canIssueInvitation: false,
        blockingReasons: ["display_name_unavailable", "diagnosis_unavailable"],
        nextAction: null,
      },
    });
  });

  it("回答可能な未完了Diagnosisがある場合だけ診断画面へ案内する", async () => {
    const result = await getCompatibilitySharePreview(
      { idToken: "id-token", lineLoginChannelId: "channel-id", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user", displayName: "あおい" },
        }),
        getPreviewSource: vi.fn().mockResolvedValue({
          diagnoses: [
            {
              id: "open",
              availability: "open",
              responseStatus: "unanswered",
            },
          ],
          answeredDiagnoses: [],
        }),
        getShareProfile: vi.fn().mockResolvedValue(availableShareProfile),
        scoreAnswers: vi.fn(),
        createPreviewToken: vi.fn().mockResolvedValue(previewToken),
      },
    );

    expect(result).toMatchObject({
      preview: {
        canIssueInvitation: false,
        blockingReasons: ["diagnosis_required"],
        nextAction: "diagnosis",
      },
    });
  });

  it("回答済みDiagnosisを採点できない場合はサービス側の理由を返す", async () => {
    const result = await getCompatibilitySharePreview(
      { idToken: "id-token", lineLoginChannelId: "channel-id", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user", displayName: "あおい" },
        }),
        getPreviewSource: vi.fn().mockResolvedValue({
          diagnoses: [{ id: "closed", availability: "closed", responseStatus: "answered" }],
          answeredDiagnoses: [
            {
              id: "closed",
              title: "終了済み",
              answers: [],
              scoringConfig: null,
            },
          ],
        }),
        getShareProfile: vi.fn().mockResolvedValue(availableShareProfile),
        scoreAnswers: vi.fn().mockReturnValue(null),
        createPreviewToken: vi.fn().mockResolvedValue(previewToken),
      },
    );

    expect(result).toMatchObject({
      preview: {
        canIssueInvitation: false,
        blockingReasons: ["scoring_unavailable"],
        nextAction: null,
      },
    });
  });

  it.each([
    { result: { type: "unavailable" as const }, reason: "profile_summary_required" },
    { result: { type: "stale" as const }, reason: "profile_summary_stale" },
  ])(
    "共有用プロフィールが利用できなければ生成画面へ案内する: $reason",
    async ({ result, reason }) => {
      const outcome = await getCompatibilitySharePreview(
        { idToken: "id-token", lineLoginChannelId: "channel-id", db, at },
        {
          createSession: vi.fn().mockResolvedValue({
            type: "resolved",
            session: { accountId: "account-1", role: "user", displayName: "あおい" },
          }),
          getPreviewSource: vi.fn().mockResolvedValue({ diagnoses: [], answeredDiagnoses: [] }),
          getShareProfile: vi.fn().mockResolvedValue(result),
          scoreAnswers: vi.fn(),
          createPreviewToken: vi.fn().mockResolvedValue(previewToken),
        },
      );

      expect(outcome).toMatchObject({
        preview: {
          aboutMe: null,
          canIssueInvitation: false,
          blockingReasons: [reason, "diagnosis_unavailable"],
          nextAction: "profile-summary",
        },
      });
    },
  );

  it.each([
    { type: "not-configured" as const },
    { type: "unauthenticated" as const, reason: "invalid token" },
    { type: "account-not-found" as const },
  ])("本人を解決できない場合は診断データを読まない: $type", async (session) => {
    const getPreviewSource = vi.fn();
    const getShareProfile = vi.fn();

    const result = await getCompatibilitySharePreview(
      { idToken: undefined, lineLoginChannelId: undefined, db, at },
      {
        createSession: vi.fn().mockResolvedValue(session),
        getPreviewSource,
        getShareProfile,
        scoreAnswers: vi.fn(),
        createPreviewToken: vi.fn(),
      },
    );

    expect(result).toEqual(session);
    expect(getPreviewSource).not.toHaveBeenCalled();
    expect(getShareProfile).not.toHaveBeenCalled();
  });
});
