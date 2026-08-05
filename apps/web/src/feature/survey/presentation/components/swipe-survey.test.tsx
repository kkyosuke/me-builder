// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const twoQuestionSurvey: SurveyDefinition = {
  ...survey,
  questions: [
    ...survey.questions,
    {
      surveyQuestionId: "sq-2",
      questionId: "q-2",
      questionVersion: 1,
      text: "次の質問",
      left: { choiceId: "no", label: "いいえ", icon: "circle-x" },
      right: { choiceId: "yes", label: "はい", icon: "circle-check" },
    },
  ],
};

afterEach(() => cleanup());

describe("SwipeSurvey answer persistence", () => {
  it("保存をバックグラウンドで続けながら次の質問へ進める", async () => {
    const onSaveAnswer = vi.fn(() => new Promise<{ acceptedAt: string }>(() => undefined));
    render(<SwipeSurvey survey={twoQuestionSurvey} onBack={vi.fn()} onSaveAnswer={onSaveAnswer} />);

    const currentAnswerButton = screen
      .getAllByRole<HTMLButtonElement>("button", { name: /はい/ })
      .find(({ disabled }) => !disabled);
    if (!currentAnswerButton) {
      throw new Error("操作できる回答ボタンがありません");
    }
    fireEvent.click(currentAnswerButton);

    expect(await screen.findByText("2 / 2")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(onSaveAnswer).toHaveBeenCalledTimes(2));
  });

  it("最後のカード後は未完了の保存を待ってから結果を表示する", async () => {
    let resolveSave: ((value: { acceptedAt: string }) => void) | undefined;
    const onSaveAnswer = vi.fn(
      () =>
        new Promise<{ acceptedAt: string }>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<SwipeSurvey survey={survey} onBack={vi.fn()} onSaveAnswer={onSaveAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: /はい/ }));

    expect(await screen.findByText("回答を保存しています")).toBeTruthy();
    expect(screen.queryByText("保存した回答から見える現在の傾向")).toBeNull();
    expect(onSaveAnswer).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave?.({ acceptedAt: "2026-08-05T00:00:01.000Z" });
    });
    expect(await screen.findByText("保存した回答から見える現在の傾向")).toBeTruthy();
  });

  it("保存失敗時は全問の操作後に同じ回答を再試行する", async () => {
    const onSaveAnswer = vi
      .fn()
      .mockRejectedValueOnce(new Error("通信に失敗しました"))
      .mockResolvedValueOnce({ acceptedAt: "2026-08-05T00:00:01.000Z" });
    render(<SwipeSurvey survey={survey} onBack={vi.fn()} onSaveAnswer={onSaveAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: /はい/ }));
    expect(await screen.findByText("通信に失敗しました")).toBeTruthy();
    expect(screen.queryByText("保存した回答から見える現在の傾向")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "保存を再試行" }));
    await waitFor(() => expect(onSaveAnswer).toHaveBeenCalledTimes(2));
    expect(onSaveAnswer.mock.calls[1]?.[0]).toEqual(onSaveAnswer.mock.calls[0]?.[0]);
    expect(await screen.findByText("保存した回答から見える現在の傾向")).toBeTruthy();
  });
});
