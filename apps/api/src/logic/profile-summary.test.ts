import type { AccountDataNamespace } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getProfileSummary } from "./profile-summary";

const accountData = {} as AccountDataNamespace;
const actor = {
  accountId: "account-1",
  authenticationMethod: "liff" as const,
  authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
};
const readModel = {
  versions: [
    {
      id: "version-1",
      sequence: 1,
      generatedAt: "2026-08-08T12:00:00.000Z",
      isLatest: true,
      generationMethod: "ai",
      summary: {
        generatedAt: "2026-08-08T12:00:00.000Z",
        headline: "まとめ",
        insights: [],
        recordCount: 0,
        diagnosisCount: 0,
        diaryCount: 0,
        latestRecordedAt: null,
      },
    },
  ],
  availableDataCounts: { diagnosis: 2, diary: 4 },
  generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
} as const;

function dependencies(diagnoses: unknown[]) {
  return {
    getDiagnosisSource: vi.fn().mockResolvedValue({ diagnoses, answeredDiagnoses: [] }),
    readProfileSummary: vi.fn().mockResolvedValue(readModel),
  };
}

describe("getProfileSummary", () => {
  it("受付中の未回答診断があれば診断を次の行動にする", async () => {
    const deps = dependencies([{ availability: "open", responseStatus: "unanswered" }]);

    const result = await getProfileSummary({ actor, accountData }, deps as never);

    expect(result).toMatchObject({ type: "resolved", nextAction: "diagnosis" });
    expect(deps.getDiagnosisSource).toHaveBeenCalledWith(
      accountData,
      "account-1",
      expect.any(Date),
    );
    expect(deps.readProfileSummary).toHaveBeenCalledWith(
      accountData,
      "account-1",
      expect.any(Date),
    );
  });

  it("回答できる診断がなければチャットを次の行動にする", async () => {
    const deps = dependencies([
      { availability: "open", responseStatus: "answered" },
      { availability: "closed", responseStatus: "in-progress" },
    ]);

    const result = await getProfileSummary({ actor, accountData }, deps as never);

    expect(result).toMatchObject({ type: "resolved", nextAction: "chat" });
  });

  it("完了済み診断を最終回答日時順に共通採点して返す", async () => {
    const diagnoses = [
      {
        id: "later",
        title: "あとに答えた診断",
        displayOrder: 2,
        availability: "open",
        responseStatus: "answered",
        lastAnsweredAt: "2026-08-12T02:00:00.000Z",
      },
      {
        id: "earlier",
        title: "先に答えた診断",
        displayOrder: 1,
        availability: "closed",
        responseStatus: "answered",
        lastAnsweredAt: "2026-08-11T02:00:00.000Z",
      },
    ];
    const deps = dependencies(diagnoses);
    deps.getDiagnosisSource.mockResolvedValue({
      diagnoses,
      answeredDiagnoses: ["later", "earlier"].map((diagnosisId) => ({
        id: diagnosisId,
        title: diagnosisId,
        description: "説明",
        responseStatus: "answered",
        answeredCount: 1,
        questionCount: 1,
        scoringConfig: {
          id: `scoring-${diagnosisId}`,
          version: 1,
          questions: [{ questionId: "q1", questionVersion: 1, choiceIds: ["yes", "no"] }],
          definition: {
            parameters: [
              {
                id: "planning",
                label: "計画性",
                lowLabel: "即興的",
                highLabel: "計画的",
              },
            ],
            choiceScores: { yes: 1, no: -1 },
            questions: { q1: { questionVersion: 1, weights: { planning: 1 } } },
            minimumCoverage: 1,
            lowMaximum: 35,
            highMinimum: 65,
            balancedLabel: "状況による",
          },
        },
        answers: [
          {
            diagnosisQuestionId: "dq1",
            questionId: "q1",
            questionVersion: 1,
            questionText: "予定を立てますか",
            choiceId: "yes",
            choiceLabel: "はい",
            acceptedAt: "2026-08-12T02:00:00.000Z",
          },
        ],
      })),
    });

    const result = await getProfileSummary({ actor, accountData }, deps as never);

    expect(result).toMatchObject({
      type: "resolved",
      diagnosisThemes: [
        {
          id: "later",
          title: "あとに答えた診断",
          scoring: { parameters: [{ id: "planning", score: 100, coverage: 100 }] },
        },
        { id: "earlier", title: "先に答えた診断" },
      ],
    });
  });

  it("保存済み版がなければAccountDataの空の読み取り結果を返す", async () => {
    const deps = dependencies([{ availability: "open", responseStatus: "unanswered" }]);
    deps.readProfileSummary.mockResolvedValue({
      versions: [],
      availableDataCounts: { diagnosis: 0, diary: 0 },
      generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
    });

    const result = await getProfileSummary({ actor, accountData }, deps as never);

    expect(result).toMatchObject({
      type: "resolved",
      versions: [],
      availableDataCounts: { diagnosis: 0, diary: 0 },
      generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
    });
  });

  it("AccountDataの保存済み版、現在件数、生成状態を返す", async () => {
    const deps = dependencies([]);

    const result = await getProfileSummary({ actor, accountData }, deps as never);

    expect(result).toMatchObject({
      type: "resolved",
      versions: [{ id: "version-1", isLatest: true }],
      availableDataCounts: { diagnosis: 2, diary: 4 },
      generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
    });
  });
});
