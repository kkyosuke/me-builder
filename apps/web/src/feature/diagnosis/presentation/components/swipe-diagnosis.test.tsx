// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosisDefinition } from "../../model/diagnosis-definition";
import { SwipeDiagnosis } from "./swipe-diagnosis";

const diagnosis: DiagnosisDefinition = {
  id: "diagnosis-1",
  title: "保存テスト",
  description: "説明",
  relationshipCategory: "general",
  questions: [
    {
      diagnosisQuestionId: "dq-1",
      questionId: "q-1",
      questionVersion: 1,
      text: "保存する質問",
      left: { choiceId: "no", label: "いいえ" },
      right: { choiceId: "yes", label: "はい" },
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
      left: { choiceId: "no", label: "いいえ" },
      right: { choiceId: "yes", label: "はい" },
    },
  ],
};

const pairedQuestionDiagnosis: DiagnosisDefinition = {
  ...diagnosis,
  title: "表裏テスト",
  questions: [
    {
      diagnosisQuestionId: "dq-front",
      questionId: "q-front",
      questionVersion: 1,
      text: "休日は家で過ごすことが多い？",
      left: { choiceId: "no", label: "いいえ" },
      right: { choiceId: "yes", label: "はい" },
    },
    {
      diagnosisQuestionId: "dq-back",
      questionId: "q-back",
      questionVersion: 1,
      text: "休日は家で過ごしたい？",
      backsideOfDiagnosisQuestionId: "dq-front",
      left: { choiceId: "no", label: "いいえ" },
      right: { choiceId: "yes", label: "はい" },
    },
  ],
};

const likertDiagnosis: DiagnosisDefinition = {
  ...diagnosis,
  questions: [
    {
      diagnosisQuestionId: "dq-likert",
      questionId: "q-likert",
      questionVersion: 1,
      text: "当てはまりますか",
      format: "likert_5",
      choices: [
        { choiceId: "level-1", label: "まったく当てはまらない", score: -1 },
        { choiceId: "level-2", label: "あまり当てはまらない", score: -0.5 },
        { choiceId: "level-3", label: "どちらともいえない", score: 0 },
        { choiceId: "level-4", label: "やや当てはまる", score: 0.5 },
        { choiceId: "level-5", label: "とても当てはまる", score: 1 },
      ],
    },
  ],
};

afterEach(() => cleanup());

describe("SwipeDiagnosis answer persistence", () => {
  it("裏面のある表は回答方向から反転し、裏の回答で従来どおり完了する", async () => {
    const onSaveAnswer = vi.fn().mockResolvedValue({
      acceptedAt: "2026-08-05T00:00:02.000Z",
    });
    const onComplete = vi.fn();
    render(
      <SwipeDiagnosis
        diagnosis={pairedQuestionDiagnosis}
        onBack={vi.fn()}
        onSaveAnswer={onSaveAnswer}
        onDeferQuestion={vi.fn()}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByLabelText("普段の行動 1/2")).toBeTruthy();
    const frontYes = screen
      .getAllByRole<HTMLButtonElement>("button", { name: "はい" })
      .find(({ disabled }) => !disabled);
    if (!frontYes) throw new Error("表面の回答ボタンがありません");
    fireEvent.click(frontYes);

    expect(document.querySelector('[style*="rotateY(180deg)"]')).toBeTruthy();
    await waitFor(() =>
      expect(
        screen
          .getAllByRole<HTMLButtonElement>("button", { name: "いいえ" })
          .find(({ disabled }) => !disabled),
      ).toBeTruthy(),
    );
    expect(onSaveAnswer.mock.calls[0]?.[0]).toMatchObject({
      diagnosisQuestionId: "dq-front",
      choiceId: "yes",
    });

    const backNo = screen
      .getAllByRole<HTMLButtonElement>("button", { name: "いいえ" })
      .find(({ disabled }) => !disabled);
    if (!backNo) throw new Error("裏面の回答ボタンがありません");
    fireEvent.click(backNo);

    await waitFor(() => expect(onSaveAnswer).toHaveBeenCalledTimes(2));
    expect(onSaveAnswer.mock.calls[1]?.[0]).toMatchObject({
      diagnosisQuestionId: "dq-back",
      choiceId: "no",
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });

  it("表面だけ保存済みなら大切にしたいことの裏面から再開する", () => {
    render(
      <SwipeDiagnosis
        diagnosis={pairedQuestionDiagnosis}
        initialAnswers={[
          {
            kind: "answer",
            diagnosisQuestionId: "dq-front",
            questionId: "q-front",
            questionVersion: 1,
            choiceId: "yes",
            direction: "right",
            acceptedAt: "2026-08-05T00:00:01.000Z",
          },
        ]}
        onBack={vi.fn()}
        onSaveAnswer={vi.fn()}
        onDeferQuestion={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("大切にしたいこと 2/2")).toBeTruthy();
    expect(screen.getByText("休日は家で過ごしたい？")).toBeTruthy();
  });

  it("5段階は5つのボタンから選択し、左右キーを回答に使わない", async () => {
    const onSaveAnswer = vi.fn().mockResolvedValue({
      acceptedAt: "2026-08-05T00:00:02.000Z",
    });
    render(
      <SwipeDiagnosis
        diagnosis={likertDiagnosis}
        onBack={vi.fn()}
        onSaveAnswer={onSaveAnswer}
        onDeferQuestion={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onSaveAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /4 やや当てはまる/ }));

    await waitFor(() => expect(onSaveAnswer).toHaveBeenCalledOnce());
    expect(onSaveAnswer.mock.calls[0]?.[0]).toMatchObject({
      diagnosisQuestionId: "dq-likert",
      choiceId: "level-4",
    });
  });
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
        onDeferQuestion={vi.fn()}
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
        onDeferQuestion={vi.fn()}
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
        onDeferQuestion={vi.fn()}
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
        onDeferQuestion={vi.fn()}
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

  it("あとで回答を保存し、成功後は一覧へ戻る", async () => {
    const onComplete = vi.fn();
    const onBack = vi.fn();
    const onDeferQuestion = vi.fn().mockResolvedValue(undefined);
    render(
      <SwipeDiagnosis
        diagnosis={diagnosis}
        onBack={onBack}
        onSaveAnswer={vi.fn()}
        onDeferQuestion={onDeferQuestion}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "あとで回答する" }));

    await waitFor(() => expect(onDeferQuestion).toHaveBeenCalledWith("dq-1"));
    // 実際の親は保存成功時に画面を閉じるため、完了表示へは進まない。
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("あとで回答の保存失敗時は同じ質問の操作を再試行できる", async () => {
    const onDeferQuestion = vi
      .fn()
      .mockRejectedValueOnce(new Error("通信失敗"))
      .mockResolvedValueOnce(undefined);
    render(
      <SwipeDiagnosis
        diagnosis={diagnosis}
        onBack={vi.fn()}
        onSaveAnswer={vi.fn()}
        onDeferQuestion={onDeferQuestion}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "あとで回答する" }));
    expect((await screen.findByRole("alert")).textContent).toContain("保存できませんでした");

    fireEvent.click(screen.getByRole("button", { name: "あとで回答する" }));
    await waitFor(() => expect(onDeferQuestion).toHaveBeenCalledTimes(2));
  });
});
