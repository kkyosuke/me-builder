// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosisDefinition } from "../../model/diagnosis-definition";
import { SwipeDiagnosis } from "./swipe-diagnosis";

const diagnosis: DiagnosisDefinition = {
  id: "diagnosis-1",
  title: "保存テスト",
  description: "説明",
  questions: [
    {
      diagnosisQuestionId: "dq-1",
      questionId: "q-1",
      questionVersion: 1,
      text: "保存する質問",
      left: { choiceId: "no", label: "いいえ", icon: "circle-x" },
      right: { choiceId: "yes", label: "はい", icon: "circle-check" },
    },
  ],
};

const twoQuestionDiagnosis: DiagnosisDefinition = {
  ...diagnosis,
  questions: [
    ...diagnosis.questions,
    {
      diagnosisQuestionId: "dq-2",
      questionId: "q-2",
      questionVersion: 1,
      text: "次の質問",
      left: { choiceId: "no", label: "いいえ", icon: "circle-x" },
      right: { choiceId: "yes", label: "はい", icon: "circle-check" },
    },
  ],
};

afterEach(() => cleanup());

describe("SwipeDiagnosis answer persistence", () => {
  it("保存済みの質問を飛ばして最初の未回答から再開する", async () => {
    const onSaveAnswer = vi.fn().mockResolvedValue({
      acceptedAt: "2026-08-05T00:00:02.000Z",
    });
    const onComplete = vi.fn();
    render(
      <SwipeDiagnosis
        diagnosis={twoQuestionDiagnosis}
        initialAnswers={[
          {
            kind: "answer",
            diagnosisQuestionId: "dq-1",
            questionId: "q-1",
            questionVersion: 1,
            choiceId: "yes",
            direction: "right",
            acceptedAt: "2026-08-05T00:00:01.000Z",
          },
        ]}
        onBack={vi.fn()}
        onSaveAnswer={onSaveAnswer}
        onComplete={onComplete}
      />,
    );

    expect(screen.queryByText("保存する質問")).toBeNull();
    expect(screen.getByText("次の質問")).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();

    fireEvent.keyDown(window, { key: "ArrowRight" });

    await waitFor(() => expect(onSaveAnswer).toHaveBeenCalledOnce());
    expect(onSaveAnswer.mock.calls[0]?.[0]).toMatchObject({ diagnosisQuestionId: "dq-2" });
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });

  it("保存をバックグラウンドで続けながら次の質問へ進める", async () => {
    const onSaveAnswer = vi.fn(() => new Promise<{ acceptedAt: string }>(() => undefined));
    render(
      <SwipeDiagnosis
        diagnosis={twoQuestionDiagnosis}
        onBack={vi.fn()}
        onSaveAnswer={onSaveAnswer}
        onComplete={vi.fn()}
      />,
    );

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

  it("最後のカード後は未完了の保存を待ち、旧結果を挟まず結果取得へ進む", async () => {
    let resolveSave: ((value: { acceptedAt: string }) => void) | undefined;
    const onSaveAnswer = vi.fn(
      () =>
        new Promise<{ acceptedAt: string }>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const onComplete = vi.fn();
    render(
      <SwipeDiagnosis
        diagnosis={diagnosis}
        onBack={vi.fn()}
        onSaveAnswer={onSaveAnswer}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /はい/ }));

    expect(await screen.findByText("回答を保存しています")).toBeTruthy();
    expect(screen.queryByText("保存した回答から見える現在の傾向")).toBeNull();
    expect(onSaveAnswer).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave?.({ acceptedAt: "2026-08-05T00:00:01.000Z" });
    });
    expect(await screen.findByText("回答結果を準備しています")).toBeTruthy();
    expect(screen.queryByText("保存した回答から見える現在の傾向")).toBeNull();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("保存失敗時は全問の操作後に同じ回答を再試行する", async () => {
    const onSaveAnswer = vi
      .fn()
      .mockRejectedValueOnce(new Error("通信に失敗しました"))
      .mockResolvedValueOnce({ acceptedAt: "2026-08-05T00:00:01.000Z" });
    const onComplete = vi.fn();
    render(
      <SwipeDiagnosis
        diagnosis={diagnosis}
        onBack={vi.fn()}
        onSaveAnswer={onSaveAnswer}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /はい/ }));
    expect(await screen.findByText("通信に失敗しました")).toBeTruthy();
    expect(screen.queryByText("保存した回答から見える現在の傾向")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "保存を再試行" }));
    await waitFor(() => expect(onSaveAnswer).toHaveBeenCalledTimes(2));
    expect(onSaveAnswer.mock.calls[1]?.[0]).toEqual(onSaveAnswer.mock.calls[0]?.[0]);
    expect(await screen.findByText("回答結果を準備しています")).toBeTruthy();
    expect(screen.queryByText("保存した回答から見える現在の傾向")).toBeNull();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("あとで回答が残る場合は回答結果への遷移を通知しない", async () => {
    const onComplete = vi.fn();
    render(
      <SwipeDiagnosis
        diagnosis={diagnosis}
        onBack={vi.fn()}
        onSaveAnswer={vi.fn()}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "あとで回答する" }));

    expect(await screen.findByText("今回の回答はここまでです")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
