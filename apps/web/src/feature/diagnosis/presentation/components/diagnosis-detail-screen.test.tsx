// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosisDefinition } from "../../model/diagnosis-definition";
import type { DiagnosisAnswer } from "../../model/types";
import { DiagnosisDetailScreen } from "./diagnosis-detail-screen";

const diagnosis: DiagnosisDefinition = {
  id: "relationship-priority",
  title: "自分と相手の優先・境界線",
  description: "頼まれごとや意思決定で、自分と相手をどう尊重するかを見ます。",
  relationshipCategory: "partner",
  questions: [
    {
      diagnosisQuestionId: "dq-1",
      questionId: "q-1",
      questionVersion: 1,
      text: "最初の質問",
      left: { choiceId: "no", label: "いいえ" },
      right: { choiceId: "yes", label: "はい" },
    },
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

const savedAnswer: DiagnosisAnswer = {
  kind: "answer",
  diagnosisQuestionId: "dq-1",
  questionId: "q-1",
  questionVersion: 1,
  choiceId: "yes",
  direction: "right",
  acceptedAt: "2026-08-05T00:00:00.000Z",
};

function renderScreen(initialAnswers: DiagnosisAnswer[] = []) {
  return render(
    <DiagnosisDetailScreen
      diagnosis={diagnosis}
      initialAnswers={initialAnswers}
      onBack={vi.fn()}
      onSaveAnswer={vi.fn()}
      onDeferQuestion={vi.fn()}
      onComplete={vi.fn()}
    />,
  );
}

describe("DiagnosisDetailScreen", () => {
  afterEach(() => cleanup());

  it("未回答なら診断画像と回答時に思い浮かべる対象を表示してから開始する", () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: diagnosis.title })).toBeTruthy();
    expect(screen.getByText(diagnosis.description)).toBeTruthy();
    expect(screen.getByText("パートナーとの関係を思い浮かべて答えてください。")).toBeTruthy();
    expect(screen.getByText("全2問")).toBeTruthy();
    expect(screen.getByRole("presentation").getAttribute("src")).toBe(
      "/images/diagnoses/relationship-priority.jpg",
    );
    expect(screen.queryByText("最初の質問")).toBeNull();

    const startButton = screen.getByRole("button", { name: "診断をはじめる" });
    startButton.focus();
    fireEvent.click(startButton);

    expect(screen.getByText("最初の質問")).toBeTruthy();
    expect(screen.getByText(/回答は1問ずつ保存されます/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: diagnosis.title })).toBe(document.activeElement);
  });

  it("保存済み回答があれば導入を挟まず最初の未回答から再開する", () => {
    renderScreen([savedAnswer]);

    expect(screen.queryByRole("button", { name: "診断をはじめる" })).toBeNull();
    expect(screen.queryByText("最初の質問")).toBeNull();
    expect(screen.getByText("次の質問")).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });
});
