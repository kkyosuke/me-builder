// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SurveyDefinition } from "../../model/survey-definition";
import { SwipeSurvey } from "./swipe-survey";

const survey: SurveyDefinition = {
  id: "survey-1",
  title: "保存テスト",
  description: "説明",
  balancedLabel: "中間",
  score: () => ({ scoringVersion: 1, parameters: [] }),
  questions: [
    {
      surveyQuestionId: "sq-1",
      questionId: "q-1",
      questionVersion: 1,
      text: "保存する質問",
      left: { choiceId: "no", label: "いいえ", icon: "circle-x" },
      right: { choiceId: "yes", label: "はい", icon: "circle-check" },
    },
  ],
};

afterEach(() => cleanup());

describe("SwipeSurvey answer persistence", () => {
  it("保存中は次の操作を無効化する", async () => {
    const onSaveAnswer = vi.fn(() => new Promise<{ acceptedAt: string }>(() => undefined));
    render(<SwipeSurvey survey={survey} onBack={vi.fn()} onSaveAnswer={onSaveAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: /はい/ }));

    expect(await screen.findByText("回答を保存しています...")).toBeTruthy();
    expect(screen.getByRole("button", { name: /はい/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /いいえ/ })).toHaveProperty("disabled", true);
    expect(onSaveAnswer).toHaveBeenCalledTimes(1);
  });

  it("保存失敗時は質問と選択を保持し、同じ回答を再試行する", async () => {
    const onSaveAnswer = vi
      .fn()
      .mockRejectedValueOnce(new Error("通信に失敗しました"))
      .mockResolvedValueOnce({ acceptedAt: "2026-08-05T00:00:01.000Z" });
    render(<SwipeSurvey survey={survey} onBack={vi.fn()} onSaveAnswer={onSaveAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: /はい/ }));
    expect(await screen.findByText("通信に失敗しました")).toBeTruthy();
    expect(screen.getByText("保存する質問")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    await waitFor(() => expect(onSaveAnswer).toHaveBeenCalledTimes(2));
    expect(onSaveAnswer.mock.calls[1]?.[0]).toEqual(onSaveAnswer.mock.calls[0]?.[0]);
  });
});
