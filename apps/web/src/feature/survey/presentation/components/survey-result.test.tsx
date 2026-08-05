// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SurveyResult } from "../../model/survey-result";
import { SurveyResultView } from "./survey-result";

const result: SurveyResult = {
  id: "survey-1",
  title: "価値観アンケート",
  description: "説明",
  responseStatus: "answered",
  answeredCount: 1,
  questionCount: 1,
  balancedLabel: "状況に応じて調整",
  profile: {
    scoringVersion: 1,
    parameters: [
      {
        id: "priority",
        label: "優先傾向",
        lowLabel: "相手を優先",
        highLabel: "自分を優先",
        score: 75,
        coverage: 100,
        band: "high",
      },
    ],
  },
  answers: [
    {
      surveyQuestionId: "sq-1",
      questionId: "q-1",
      questionVersion: 1,
      questionText: "自分の余裕を優先したい。",
      choiceId: "yes",
      choiceLabel: "はい",
      acceptedAt: "2026-08-05T00:00:00.000Z",
    },
  ],
};

describe("SurveyResultView", () => {
  afterEach(() => cleanup());

  it("傾向スコアと保存済みの回答内容を表示する", () => {
    render(<SurveyResultView result={result} onBack={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "価値観アンケート" })).toBeTruthy();
    expect(screen.getByText("優先傾向")).toBeTruthy();
    expect(screen.getByText("自分を優先")).toBeTruthy();
    expect(screen.getByText("自分の余裕を優先したい。")).toBeTruthy();
    expect(screen.getByText("はい")).toBeTruthy();
    expect(screen.getByText("1 / 1問に回答")).toBeTruthy();
  });

  it("一覧へ戻る操作を通知する", () => {
    const onBack = vi.fn();
    render(<SurveyResultView result={result} onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: "アンケート一覧" }));

    expect(onBack).toHaveBeenCalledOnce();
  });
});
