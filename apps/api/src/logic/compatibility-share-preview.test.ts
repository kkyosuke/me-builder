import type { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import {
  getCompatibilityShareConsent,
  loadCompatibilitySharePreviewData,
} from "./compatibility-share-preview";

const db = {} as D1.shared.Client;
const at = new Date("2026-08-09T00:00:00.000Z");
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

describe("getCompatibilityShareConsent", () => {
  it("共有可否と表示名だけを返し、共有される内容を返さない", async () => {
    const createSession = vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user", displayName: " あおい " },
    });
    const getPreviewSource = vi.fn().mockResolvedValue({
      diagnoses: [
        {
          id: "answered",
          relationshipCategory: "general",
          availability: "open",
          responseStatus: "answered",
        },
      ],
      answeredDiagnoses: [
        {
          id: "answered",
          title: "時間と予定",
          relationshipCategory: "general",
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

    const result = await getCompatibilityShareConsent(
      { idToken: "id-token", lineLoginChannelId: "channel-id", db, at },
      {
        createSession,
        getPreviewSource,
        getShareProfile: vi.fn().mockResolvedValue(availableShareProfile),
        scoreAnswers,
      },
    );

    expect(getPreviewSource).toHaveBeenCalledWith(undefined, "account-1", at);
    expect(result).toEqual({
      type: "resolved",
      consent: {
        displayName: "あおい",
        avatarUrl: "/api/profile/avatar",
        canShare: true,
        blockingReasons: [],
        nextAction: null,
      },
    });
  });

  it("共有できる内容がまだなくても共有を開始できる", async () => {
    const result = await getCompatibilityShareConsent(
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
              relationshipCategory: "general",
              availability: "open",
              responseStatus: "unanswered",
            },
          ],
          answeredDiagnoses: [],
        }),
        getShareProfile: vi.fn().mockResolvedValue(availableShareProfile),
        scoreAnswers: vi.fn(),
      },
    );

    expect(result).toEqual({
      type: "resolved",
      consent: {
        displayName: "あおい",
        avatarUrl: "/api/profile/avatar",
        canShare: true,
        blockingReasons: [],
        nextAction: "diagnosis",
      },
    });
  });

  it("選択した関係カテゴリとgeneralだけで次の案内を判定する", async () => {
    const result = await getCompatibilityShareConsent(
      {
        idToken: "id-token",
        lineLoginChannelId: "channel-id",
        db,
        relationshipCategory: "family",
        at,
      },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user", displayName: "あおい" },
        }),
        getPreviewSource: vi.fn().mockResolvedValue({
          diagnoses: [
            {
              id: "work-open",
              relationshipCategory: "work",
              availability: "open",
              responseStatus: "unanswered",
            },
          ],
          answeredDiagnoses: [],
        }),
        getShareProfile: vi.fn().mockResolvedValue(availableShareProfile),
        scoreAnswers: vi.fn(),
      },
    );

    expect(result).toMatchObject({ consent: { nextAction: null } });
  });

  it("表示名を確認できない場合だけ共有を開始できない", async () => {
    const result = await getCompatibilityShareConsent(
      { idToken: "id-token", lineLoginChannelId: "channel-id", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user" },
        }),
        getPreviewSource: vi.fn().mockResolvedValue({ diagnoses: [], answeredDiagnoses: [] }),
        getShareProfile: vi.fn().mockResolvedValue(availableShareProfile),
        scoreAnswers: vi.fn(),
      },
    );

    expect(result).toEqual({
      type: "resolved",
      consent: {
        displayName: null,
        avatarUrl: "/api/profile/avatar",
        canShare: false,
        blockingReasons: ["display_name_unavailable"],
        nextAction: null,
      },
    });
  });

  it.each([{ type: "unavailable" as const }, { type: "stale" as const }])(
    "共有用プロフィールを開示できなければ生成画面へ案内する: $type",
    async (profileResult) => {
      const outcome = await getCompatibilityShareConsent(
        { idToken: "id-token", lineLoginChannelId: "channel-id", db, at },
        {
          createSession: vi.fn().mockResolvedValue({
            type: "resolved",
            session: { accountId: "account-1", role: "user", displayName: "あおい" },
          }),
          getPreviewSource: vi.fn().mockResolvedValue({ diagnoses: [], answeredDiagnoses: [] }),
          getShareProfile: vi.fn().mockResolvedValue(profileResult),
          scoreAnswers: vi.fn(),
        },
      );

      expect(outcome).toMatchObject({
        consent: { canShare: true, nextAction: "profile-summary" },
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

    const result = await getCompatibilityShareConsent(
      { idToken: undefined, lineLoginChannelId: undefined, db, at },
      {
        createSession: vi.fn().mockResolvedValue(session),
        getPreviewSource,
        getShareProfile,
        scoreAnswers: vi.fn(),
      },
    );

    expect(result).toEqual(session);
    expect(getPreviewSource).not.toHaveBeenCalled();
    expect(getShareProfile).not.toHaveBeenCalled();
  });
});

describe("loadCompatibilitySharePreviewData", () => {
  it("採点できたテーマだけを共有表示へ含め、指紋を外へ出さない", async () => {
    const validScoring = {
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
          band: "high" as const,
        },
      ],
    };

    const data = await loadCompatibilitySharePreviewData(
      {
        accountId: "account-1",
        verifiedDisplayName: "あおい",
        accountData: undefined,
        at,
      },
      {
        getPreviewSource: vi.fn().mockResolvedValue({
          diagnoses: [
            {
              id: "valid",
              relationshipCategory: "partner",
              availability: "open",
              responseStatus: "answered",
            },
            {
              id: "invalid",
              relationshipCategory: "general",
              availability: "open",
              responseStatus: "answered",
            },
          ],
          answeredDiagnoses: [
            {
              id: "valid",
              title: "時間と予定",
              relationshipCategory: "general",
              answers: [],
              scoringConfig: { id: "config-valid" },
            },
            {
              id: "invalid",
              title: "採点不能",
              relationshipCategory: "general",
              answers: [],
              scoringConfig: { id: "config-invalid" },
            },
          ],
        }),
        getShareProfile: vi.fn().mockResolvedValue(availableShareProfile),
        scoreAnswers: vi
          .fn()
          .mockImplementation((_answers, config) =>
            config?.id === "config-valid" ? validScoring : null,
          ),
      },
    );

    expect(data.themes).toMatchObject([{ diagnosisId: "valid" }]);
    expect(data.aboutMe).toEqual({
      profileSummaryVersionId: "summary-version-1",
      generatedAt: "2026-08-11T00:00:00.000Z",
      statements: shareProfile.statements,
    });
    expect(data.nextAction).toBeNull();
  });

  it("選択した関係カテゴリとgeneral以外を共有対象にしない", async () => {
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
    const data = await loadCompatibilitySharePreviewData(
      {
        accountId: "account-1",
        verifiedDisplayName: "あおい",
        accountData: undefined,
        at,
        relationshipCategory: "partner",
      },
      {
        getPreviewSource: vi.fn().mockResolvedValue({
          diagnoses: [
            {
              id: "partner-open",
              relationshipCategory: "partner",
              availability: "open",
              responseStatus: "unanswered",
            },
            {
              id: "work-open",
              relationshipCategory: "work",
              availability: "open",
              responseStatus: "unanswered",
            },
          ],
          answeredDiagnoses: [
            {
              id: "partner-answered",
              title: "パートナーとの会話",
              relationshipCategory: "partner",
              answers: [],
              scoringConfig: { id: "config-partner" },
            },
            {
              id: "general-answered",
              title: "人間関係全般",
              relationshipCategory: "general",
              answers: [],
              scoringConfig: { id: "config-general" },
            },
            {
              id: "work-answered",
              title: "仕事での会話",
              relationshipCategory: "work",
              answers: [],
              scoringConfig: { id: "config-work" },
            },
          ],
        }),
        getShareProfile: vi.fn().mockResolvedValue(availableShareProfile),
        scoreAnswers,
      },
    );

    expect(data.themes.map(({ diagnosisId }) => diagnosisId)).toEqual([
      "partner-answered",
      "general-answered",
    ]);
    expect(data.hasAnswerableDiagnosis).toBe(true);
    expect(data.nextAction).toBeNull();
    expect(scoreAnswers).toHaveBeenCalledTimes(2);
  });
});
