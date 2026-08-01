import { describe, expect, it } from "vitest";
import {
  RELATIONSHIP_PRIORITY_QUESTIONS,
  getParameterSummary,
  scoreRelationshipPriority,
} from "./relationship-priority";
import type { SurveyAnswer } from "./types";

function answer(questionNumber: number, value: "yes" | "no", version = 1): SurveyAnswer {
  return {
    kind: "choice",
    questionId: `q-relationship-priority-${String(questionNumber).padStart(2, "0")}`,
    questionVersion: version,
    value,
    direction: value === "yes" ? "right" : "left",
    answeredAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("RELATIONSHIP_PRIORITY_QUESTIONS", () => {
  it("version 1のYes／No質問を10問持つこと", () => {
    expect(RELATIONSHIP_PRIORITY_QUESTIONS).toHaveLength(10);
    expect(new Set(RELATIONSHIP_PRIORITY_QUESTIONS.map(({ id }) => id)).size).toBe(10);

    for (const question of RELATIONSHIP_PRIORITY_QUESTIONS) {
      expect(question.version).toBe(1);
      expect(question.left.value).toBe("no");
      expect(question.right.value).toBe("yes");
    }
  });
});

describe("scoreRelationshipPriority", () => {
  it("全問Yesを4つの独立したパラメータへ決定的に変換すること", () => {
    const profile = scoreRelationshipPriority(
      RELATIONSHIP_PRIORITY_QUESTIONS.map((_, index) => answer(index + 1, "yes")),
    );

    expect(profile.scoringVersion).toBe(1);
    expect(profile.parameters).toEqual([
      expect.objectContaining({ id: "priority-balance", score: 33, coverage: 100, band: "low" }),
      expect.objectContaining({ id: "autonomy", score: 56, coverage: 100, band: "balanced" }),
      expect.objectContaining({
        id: "boundary-expression",
        score: 60,
        coverage: 100,
        band: "balanced",
      }),
      expect.objectContaining({
        id: "support-flexibility",
        score: 67,
        coverage: 100,
        band: "high",
      }),
    ]);
  });

  it("自分／相手の優先について高い側へ揃った回答を100にすること", () => {
    const profile = scoreRelationshipPriority([
      answer(1, "yes"),
      answer(2, "no"),
      answer(3, "no"),
      answer(7, "no"),
      answer(9, "no"),
      answer(10, "yes"),
    ]);

    expect(profile.parameters[0]).toMatchObject({
      id: "priority-balance",
      score: 100,
      coverage: 100,
      band: "high",
    });
  });

  it("自分／相手の優先について低い側へ揃った回答を0にすること", () => {
    const profile = scoreRelationshipPriority([
      answer(1, "no"),
      answer(2, "yes"),
      answer(3, "yes"),
      answer(7, "yes"),
      answer(9, "yes"),
      answer(10, "no"),
    ]);

    expect(profile.parameters[0]).toMatchObject({ score: 0, coverage: 100, band: "low" });
  });

  it("coverageが60%未満ならスコアを表示可能にしないこと", () => {
    const profile = scoreRelationshipPriority([answer(1, "yes")]);

    expect(profile.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "priority-balance", score: null, coverage: 17 }),
        expect.objectContaining({ id: "boundary-expression", score: null, coverage: 20 }),
      ]),
    );
    expect(profile.parameters.every(({ band }) => band === "insufficient")).toBe(true);
  });

  it("未知の質問、スキップ、異なる質問版を計算へ含めないこと", () => {
    const profile = scoreRelationshipPriority([
      answer(1, "yes", 2),
      {
        kind: "skipped",
        questionId: "q-relationship-priority-02",
        questionVersion: 1,
        answeredAt: "2026-08-01T00:00:00.000Z",
      },
      {
        ...answer(1, "yes"),
        questionId: "q-unknown",
      },
    ]);

    expect(
      profile.parameters.every(({ score, coverage }) => score === null && coverage === 0),
    ).toBe(true);
  });

  it("同じ質問の再回答では最後の選択を現在の回答として使うこと", () => {
    const common = [
      answer(2, "no"),
      answer(3, "no"),
      answer(7, "no"),
      answer(9, "no"),
      answer(10, "yes"),
    ];
    const profile = scoreRelationshipPriority([answer(1, "no"), ...common, answer(1, "yes")]);

    expect(profile.parameters[0]).toMatchObject({ score: 100, coverage: 100 });
  });

  it("傾向ラベルをbandから取得すること", () => {
    const parameter = scoreRelationshipPriority(
      RELATIONSHIP_PRIORITY_QUESTIONS.map((_, index) => answer(index + 1, "yes")),
    ).parameters[3];
    if (!parameter) {
      throw new Error("支援の柔軟性パラメータがありません");
    }

    expect(getParameterSummary(parameter)).toBe("相手のために調整しやすい");
    expect(
      getParameterSummary({ ...parameter, score: null, coverage: 0, band: "insufficient" }),
    ).toBe("回答不足");
  });
});
