import { describe, expect, it } from "vitest";
import { scoreDiagnosisAnswers } from "./diagnosis-scoring";

const answer = (questionId: string, choiceId = "yes", questionVersion = 1) => ({
  questionId,
  questionVersion,
  choiceId,
});

describe("scoreDiagnosisAnswers", () => {
  it("診断IDに対応する版付きプロフィールを計算する", () => {
    const answers = Array.from({ length: 10 }, (_, index) =>
      answer(`q-relationship-priority-${String(index + 1).padStart(2, "0")}`),
    );

    const scoring = scoreDiagnosisAnswers("relationship-priority", answers);

    expect(scoring).toMatchObject({
      scoringVersion: 1,
      balancedLabel: "状況に応じて調整",
    });
    expect(scoring?.parameters).toEqual([
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

  it("お金と消費の全問Yesを既存の5パラメータへ変換する", () => {
    const answers = Array.from({ length: 10 }, (_, index) =>
      answer(`q-money-${String(index + 1).padStart(2, "0")}`),
    );

    const scoring = scoreDiagnosisAnswers("money-values", answers);

    expect(scoring?.parameters).toEqual([
      expect.objectContaining({ id: "future-preparation", score: 50, coverage: 100 }),
      expect.objectContaining({ id: "financial-sharing", score: 67, coverage: 100 }),
      expect.objectContaining({ id: "fairness-flexibility", score: 50, coverage: 100 }),
      expect.objectContaining({ id: "durable-value", score: 40, coverage: 100 }),
      expect.objectContaining({ id: "risk-tolerance", score: 75, coverage: 100 }),
    ]);
  });

  it("回答充足率が閾値未満の軸は断定しない", () => {
    const scoring = scoreDiagnosisAnswers("money-values", [answer("q-money-01")]);

    expect(
      scoring?.parameters.every(({ score, band }) => score === null && band === "insufficient"),
    ).toBe(true);
  });

  it("未知の選択肢と設定版に一致しない回答を採点に含めない", () => {
    const scoring = scoreDiagnosisAnswers("money-values", [
      answer("q-money-01", "unknown"),
      answer("q-money-02", "yes", 2),
    ]);

    expect(scoring?.parameters.every(({ coverage }) => coverage === 0)).toBe(true);
  });

  it("同じ質問へ複数回答がある場合は最後の回答を現在値にする", () => {
    const fixedAnswers = [2, 3, 7, 9].map((number) =>
      answer(`q-relationship-priority-${String(number).padStart(2, "0")}`, "no"),
    );
    const scoring = scoreDiagnosisAnswers("relationship-priority", [
      answer("q-relationship-priority-01", "no"),
      ...fixedAnswers,
      answer("q-relationship-priority-10"),
      answer("q-relationship-priority-01"),
    ]);

    expect(scoring?.parameters[0]).toMatchObject({ score: 100, coverage: 100, band: "high" });
  });

  it("採点設定がない診断はnullを返す", () => {
    expect(scoreDiagnosisAnswers("new-diagnosis", [answer("q-new-01")])).toBeNull();
  });
});
