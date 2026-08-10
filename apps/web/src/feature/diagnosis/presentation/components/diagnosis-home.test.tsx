// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosisListItem } from "../../model/diagnosis-list-item";
import { DiagnosisHome } from "./diagnosis-home";

function diagnosis(overrides: Partial<DiagnosisListItem>): DiagnosisListItem {
  return {
    id: "diagnosis",
    title: "診断",
    description: "説明",
    opensAt: "2026-08-01T00:00:00.000Z",
    closesAt: null,
    displayOrder: 1,
    availability: "open",
    responseStatus: "unanswered",
    answeredCount: 0,
    questionCount: 10,
    lastAnsweredAt: null,
    ...overrides,
  };
}

describe("DiagnosisHome", () => {
  afterEach(() => cleanup());

  it("診断一覧の取得中はカードのSkeletonを表示する", () => {
    render(
      <DiagnosisHome
        diagnoses={{ status: "loading" }}
        onOpenDiagnosis={vi.fn()}
        onRetry={vi.fn()}
        canResetDiagnosisData={false}
        resetState={{ status: "idle" }}
        onResetDiagnosisData={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "診断一覧を読み込み中" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "診断" })).toBeTruthy();
  });

  it("主ナビゲーションで診断を現在位置として表示する", () => {
    render(
      <DiagnosisHome
        diagnoses={{ status: "success", data: [] }}
        onOpenDiagnosis={vi.fn()}
        onRetry={vi.fn()}
        canResetDiagnosisData={false}
        resetState={{ status: "idle" }}
        onResetDiagnosisData={vi.fn()}
      />,
    );

    expect(screen.getByText("私をさがす")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "診断" })).toBeTruthy();
    expect(screen.queryByText("me-builder")).toBeNull();
    expect(screen.getByRole("link", { name: "診断" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "わたし" }).getAttribute("href")).toBe("/me");
    expect(screen.getByRole("link", { name: "わたし" }).getAttribute("aria-current")).toBeNull();
    expect(
      within(screen.getByRole("navigation", { name: "メインナビゲーション" }))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["わたし", "診断", "相性"]);
  });

  it("回答途中のカードだけに進捗を x/x 形式で表示する", () => {
    render(
      <DiagnosisHome
        diagnoses={{
          status: "success",
          data: [
            diagnosis({
              id: "in-progress",
              title: "途中の診断",
              responseStatus: "in-progress",
              answeredCount: 3,
            }),
            diagnosis({ id: "unanswered", title: "未回答の診断" }),
            diagnosis({
              id: "answered",
              title: "回答済みの診断",
              responseStatus: "answered",
              answeredCount: 10,
              lastAnsweredAt: "2026-08-05T00:00:00.000Z",
            }),
          ],
        }}
        onOpenDiagnosis={vi.fn()}
        onRetry={vi.fn()}
        canResetDiagnosisData={false}
        resetState={{ status: "idle" }}
        onResetDiagnosisData={vi.fn()}
      />,
    );

    const inProgressCard = screen.getByRole("button", { name: /途中の診断/ });
    const unansweredCard = screen.getByRole("button", { name: /未回答の診断/ });

    expect(within(inProgressCard).getByText("3/10")).toBeTruthy();
    expect(within(inProgressCard).queryByText("回答途中")).toBeNull();
    expect(within(unansweredCard).queryByText("未回答")).toBeNull();
    expect(within(unansweredCard).queryByText(/0\/10|10問/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^回答済み 1件$/ }));
    const answeredCard = screen.getByRole("button", { name: /回答済みの診断/ });

    expect(within(answeredCard).queryByText("回答済み")).toBeNull();
    expect(within(answeredCard).queryByText(/10\/10|10問/)).toBeNull();
  });

  it("診断ごとのサムネイルと未知の診断用フォールバックを表示する", () => {
    render(
      <DiagnosisHome
        diagnoses={{
          status: "success",
          data: [
            diagnosis({ id: "conversation-emotion", title: "会話と感情表現" }),
            diagnosis({ id: "time-planning", title: "時間と予定" }),
            diagnosis({ id: "new-diagnosis", title: "新しい診断", displayOrder: 3 }),
          ],
        }}
        onOpenDiagnosis={vi.fn()}
        onRetry={vi.fn()}
        canResetDiagnosisData={false}
        resetState={{ status: "idle" }}
        onResetDiagnosisData={vi.fn()}
      />,
    );

    const conversationEmotionCard = screen.getByRole("button", { name: /会話と感情表現/ });
    const timePlanningCard = screen.getByRole("button", { name: /時間と予定/ });
    const fallbackCard = screen.getByRole("button", { name: /新しい診断/ });

    expect(conversationEmotionCard.querySelector("img")?.getAttribute("src")).toBe(
      "/images/diagnoses/conversation-emotion.jpg",
    );
    expect(timePlanningCard.querySelector("img")?.getAttribute("src")).toBe(
      "/images/diagnoses/time-planning.jpg",
    );
    expect(fallbackCard.querySelector("img")?.getAttribute("src")).toBe(
      "/images/diagnoses/default.jpg",
    );
  });
});
