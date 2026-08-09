import type { AccountDataNamespace, d1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getProfileSummary } from "./profile-summary";

const db = {} as d1.Client;
const accountData = {} as AccountDataNamespace;
const at = new Date("2026-08-09T03:00:00.000Z");

function completedDiagnosis(input: {
  id: string;
  displayOrder: number;
  acceptedAt?: string;
  choiceId?: "no" | "middle" | "yes";
  withScoring?: boolean;
}) {
  const questionId = `${input.id}-question`;
  return {
    displayOrder: input.displayOrder,
    diagnosis: {
      id: input.id,
      title: input.id,
      description: `${input.id} description`,
      responseStatus: "answered",
      answeredCount: 1,
      questionCount: 1,
      scoringConfig:
        input.withScoring === false
          ? null
          : {
              id: `${input.id}-scoring`,
              version: 1,
              definition: {
                parameters: [
                  {
                    id: "first",
                    label: "第1軸",
                    lowLabel: `${input.id}の低い側`,
                    highLabel: `${input.id}の高い側`,
                  },
                  {
                    id: "second",
                    label: "第2軸",
                    lowLabel: `${input.id}の第2低い側`,
                    highLabel: `${input.id}の第2高い側`,
                  },
                ],
                choiceScores: { no: -1, middle: 0, yes: 1 },
                questions: {
                  [questionId]: { questionVersion: 1, weights: { first: 1, second: -0.5 } },
                },
                minimumCoverage: 1,
                lowMaximum: 35,
                highMinimum: 65,
                balancedLabel: "状況による",
              },
              questions: [{ questionId, questionVersion: 1, choiceIds: ["no", "middle", "yes"] }],
            },
      answers: [
        {
          diagnosisQuestionId: `${input.id}-diagnosis-question`,
          questionId,
          questionVersion: 1,
          questionText: "質問",
          choiceId: input.choiceId ?? "yes",
          choiceLabel: "はい",
          acceptedAt: input.acceptedAt ?? "2026-08-08T01:00:00.000Z",
        },
      ],
    },
  } as const;
}

function dependencies(
  data: {
    diagnoses: unknown[];
    completedDiagnoses: unknown[];
  },
  diaryData: Awaited<ReturnType<typeof d1.action.brain.findProfileSummaryDiaryData>> = {
    memories: [],
    memoryCount: 0,
  },
) {
  return {
    createSession: vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user" },
    }),
    findSummaryData: vi.fn().mockResolvedValue(data),
    findDiaryData: vi.fn().mockResolvedValue(diaryData),
  };
}

describe("getProfileSummary", () => {
  it("完了済み診断を再採点し、決定的な順序で最大3件の傾向を返す", async () => {
    const deps = dependencies({
      diagnoses: [
        { availability: "closed", responseStatus: "answered" },
        { availability: "open", responseStatus: "unanswered" },
      ],
      completedDiagnoses: [
        completedDiagnosis({
          id: "later",
          displayOrder: 20,
          acceptedAt: "2026-08-08T02:00:00.000Z",
        }),
        completedDiagnosis({ id: "first", displayOrder: 10 }),
      ],
    });

    const result = await getProfileSummary(
      { idToken: "token", lineLoginChannelId: "channel", db, accountData, at },
      deps as never,
    );

    expect(result).toMatchObject({
      type: "resolved",
      nextAction: "diagnosis",
      summary: {
        generatedAt: "2026-08-09T03:00:00.000Z",
        recordCount: 2,
        diagnosisCount: 2,
        diaryCount: 0,
        diaryMemories: [],
        latestRecordedAt: "2026-08-08T02:00:00.000Z",
        insights: [
          {
            key: "first:first",
            label: "firstの高い側",
            description: "「firstの高い側」傾向があります",
            evidenceCount: 1,
            sources: ["diagnosis"],
          },
          { key: "first:second", label: "firstの第2低い側" },
          { key: "later:first", label: "laterの高い側" },
        ],
        themes: [
          {
            diagnosisId: "later",
            answerCount: 1,
            lastAnsweredAt: "2026-08-08T02:00:00.000Z",
            scoring: {
              parameters: [
                expect.objectContaining({ id: "first" }),
                expect.objectContaining({ id: "second" }),
              ],
            },
          },
          { diagnosisId: "first" },
        ],
      },
    });
    expect(deps.findSummaryData).toHaveBeenCalledWith(accountData, "account-1", at);
    expect(deps.findDiaryData).toHaveBeenCalledWith(accountData, "account-1");
  });

  it("有効な結果が中央帯だけなら設計済みの説明を返す", async () => {
    const deps = dependencies({
      diagnoses: [{ availability: "closed", responseStatus: "answered" }],
      completedDiagnoses: [
        completedDiagnosis({ id: "balanced", displayOrder: 0, choiceId: "middle" }),
      ],
    });

    const result = await getProfileSummary(
      { idToken: "token", lineLoginChannelId: "channel", db, accountData, at },
      deps as never,
    );

    expect(result).toMatchObject({
      type: "resolved",
      nextAction: null,
      summary: {
        headline: "回答したテーマでは、状況に応じて選び方を調整する傾向が見えています",
        insights: [],
      },
    });
  });

  it("完了済み診断がなければ未完了の入力があってもまとめを返さない", async () => {
    const deps = dependencies({
      diagnoses: [{ availability: "open", responseStatus: "in-progress" }],
      completedDiagnoses: [],
    });

    const result = await getProfileSummary(
      { idToken: "token", lineLoginChannelId: "channel", db, accountData, at },
      deps as never,
    );

    expect(result).toMatchObject({ type: "resolved", summary: null, nextAction: "diagnosis" });
  });

  it("診断結果がなくてもactiveな日記Memoryをまとめとして返す", async () => {
    const deps = dependencies(
      {
        diagnoses: [{ availability: "open", responseStatus: "unanswered" }],
        completedDiagnoses: [],
      },
      {
        memories: [
          {
            id: "memory-1",
            statement: "公開予定を一週間延期した",
            recordedAt: "2026-08-09T01:00:00.000Z",
            evidenceCount: 2,
          },
        ],
        memoryCount: 1,
      },
    );

    const result = await getProfileSummary(
      { idToken: "token", lineLoginChannelId: "channel", db, accountData, at },
      deps as never,
    );

    expect(result).toMatchObject({
      type: "resolved",
      nextAction: "diagnosis",
      summary: {
        headline: "日記から、最近の出来事を振り返れます",
        insights: [],
        themes: [],
        diaryMemories: [
          {
            id: "memory-1",
            statement: "公開予定を一週間延期した",
            evidenceCount: 2,
          },
        ],
        recordCount: 0,
        diagnosisCount: 0,
        diaryCount: 1,
        latestRecordedAt: "2026-08-09T01:00:00.000Z",
      },
    });
  });

  it("採点設定がない診断も回答済みテーマとして返す", async () => {
    const deps = dependencies({
      diagnoses: [{ availability: "closed", responseStatus: "answered" }],
      completedDiagnoses: [
        completedDiagnosis({ id: "unconfigured", displayOrder: 0, withScoring: false }),
      ],
    });

    const result = await getProfileSummary(
      { idToken: "token", lineLoginChannelId: "channel", db, accountData, at },
      deps as never,
    );

    expect(result).toMatchObject({
      type: "resolved",
      summary: {
        headline: "回答は保存されていますが、傾向はまだ表示できません",
        themes: [{ diagnosisId: "unconfigured", scoring: null }],
      },
    });
  });

  it("本人を解決できなければサマリー入力を取得しない", async () => {
    const deps = dependencies({ diagnoses: [], completedDiagnoses: [] });
    deps.createSession.mockResolvedValue({ type: "unauthenticated", reason: "invalid" } as never);

    const result = await getProfileSummary(
      { idToken: undefined, lineLoginChannelId: "channel", db, accountData, at },
      deps as never,
    );

    expect(result).toEqual({ type: "unauthenticated", reason: "invalid" });
    expect(deps.findSummaryData).not.toHaveBeenCalled();
    expect(deps.findDiaryData).not.toHaveBeenCalled();
  });
});
