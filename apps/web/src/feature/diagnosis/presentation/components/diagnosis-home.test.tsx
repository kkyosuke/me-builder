// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosisListItem } from "../../model/diagnosis-list-item";
import type { RelationshipCategoryFilter } from "../../model/relationship-category";
import { DiagnosisHome } from "./diagnosis-home";

function diagnosis(overrides: Partial<DiagnosisListItem>): DiagnosisListItem {
  return {
    id: "diagnosis",
    title: "診断",
    description: "説明",
    relationshipCategory: "general",
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

function StatefulDiagnosisHome(
  props: Omit<
    React.ComponentProps<typeof DiagnosisHome>,
    "categoryFilter" | "isAnsweredOpen" | "onAnsweredOpenChange" | "onCategoryFilterChange"
  >,
) {
  const [categoryFilter, setCategoryFilter] = useState<RelationshipCategoryFilter>("all");
  const [isAnsweredOpen, setIsAnsweredOpen] = useState(false);
  return (
    <DiagnosisHome
      {...props}
      categoryFilter={categoryFilter}
      isAnsweredOpen={isAnsweredOpen}
      onAnsweredOpenChange={setIsAnsweredOpen}
      onCategoryFilterChange={setCategoryFilter}
    />
  );
}

describe("DiagnosisHome", () => {
  afterEach(() => cleanup());

  it("診断一覧の取得中はカードのSkeletonを表示する", () => {
    render(
      <StatefulDiagnosisHome
        diagnoses={{ status: "loading" }}
        onOpenDiagnosis={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "診断一覧を読み込み中" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "わたしの診断" })).toBeTruthy();
  });

  it("主ナビゲーションで診断を現在位置として表示する", () => {
    render(
      <StatefulDiagnosisHome
        diagnoses={{ status: "success", data: [] }}
        onOpenDiagnosis={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("私をひもとく")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "わたしの診断" })).toBeTruthy();
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
      <StatefulDiagnosisHome
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

  it("カテゴリラベルを表示し、一覧をチップで絞り込む", () => {
    render(
      <StatefulDiagnosisHome
        diagnoses={{
          status: "success",
          data: [
            diagnosis({
              id: "partner",
              title: "パートナー向け診断",
              relationshipCategory: "partner",
            }),
            diagnosis({
              id: "work",
              title: "仕事向け診断",
              relationshipCategory: "work",
              displayOrder: 2,
            }),
          ],
        }}
        onOpenDiagnosis={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const filters = within(screen.getByRole("group", { name: "関係カテゴリで絞り込む" }));
    expect(filters.getByRole("button", { name: "全部" }).getAttribute("aria-pressed")).toBe("true");
    expect(filters.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "全部",
      "パートナー",
      "家族",
      "友達",
      "仕事",
      "自分自身",
    ]);
    expect(screen.getByRole("button", { name: /パートナー向け診断/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /仕事向け診断/ })).toBeTruthy();
    expect(
      within(screen.getByRole("button", { name: /パートナー向け診断/ })).getByText("パートナー")
        .className,
    ).toContain("bg-rose-100");

    fireEvent.click(filters.getByRole("button", { name: "仕事" }));

    expect(screen.queryByRole("button", { name: /パートナー向け診断/ })).toBeNull();
    expect(screen.getByRole("button", { name: /仕事向け診断/ })).toBeTruthy();
    expect(filters.getByRole("button", { name: "仕事" }).getAttribute("aria-pressed")).toBe("true");
    expect(filters.getByRole("button", { name: "仕事" }).className).toContain(
      "aria-pressed:bg-blue-100",
    );
  });

  it("カテゴリが1種類だけでも全カテゴリの絞り込みを表示する", () => {
    render(
      <StatefulDiagnosisHome
        diagnoses={{
          status: "success",
          data: [diagnosis({ id: "general", title: "自分自身の診断" })],
        }}
        onOpenDiagnosis={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const filters = within(screen.getByRole("group", { name: "関係カテゴリで絞り込む" }));
    expect(filters.getByRole("button", { name: "パートナー" })).toBeTruthy();
    expect(filters.getByRole("button", { name: "自分自身" })).toBeTruthy();
    expect(
      within(screen.getByRole("button", { name: /自分自身の診断/ })).getByText("自分自身"),
    ).toBeTruthy();

    fireEvent.click(filters.getByRole("button", { name: "パートナー" }));
    expect(screen.getByText("このカテゴリの診断はありません。")).toBeTruthy();

    fireEvent.click(filters.getByRole("button", { name: "自分自身" }));
    expect(screen.getByRole("button", { name: /自分自身の診断/ })).toBeTruthy();
    expect(filters.getByRole("button", { name: "自分自身" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(filters.getByRole("button", { name: "自分自身" }).className).toContain(
      "aria-pressed:bg-slate-100",
    );
  });

  it("診断ごとのサムネイルと未知の診断用フォールバックを表示する", () => {
    render(
      <StatefulDiagnosisHome
        diagnoses={{
          status: "success",
          data: [
            diagnosis({ id: "conversation-emotion", title: "会話と感情表現" }),
            diagnosis({ id: "time-planning", title: "時間と予定" }),
            diagnosis({
              id: "life-priorities",
              title: "優先順位と人生の方向性",
              displayOrder: 3,
            }),
            diagnosis({
              id: "work-values",
              title: "仕事の価値観・働き方",
              displayOrder: 4,
            }),
            diagnosis({
              id: "work-relationship-style",
              title: "仕事の変化・周囲との関わり方",
              displayOrder: 5,
            }),
            diagnosis({
              id: "family-support-style",
              title: "家族との距離感・支え合い",
              displayOrder: 6,
            }),
            diagnosis({
              id: "friendship-style",
              title: "友達との距離感・付き合い方",
              displayOrder: 7,
            }),
            diagnosis({ id: "new-diagnosis", title: "新しい診断", displayOrder: 8 }),
          ],
        }}
        onOpenDiagnosis={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const conversationEmotionCard = screen.getByRole("button", { name: /会話と感情表現/ });
    const timePlanningCard = screen.getByRole("button", { name: /時間と予定/ });
    const lifePrioritiesCard = screen.getByRole("button", { name: /優先順位と人生の方向性/ });
    const workValuesCard = screen.getByRole("button", { name: /仕事の価値観・働き方/ });
    const workRelationshipStyleCard = screen.getByRole("button", {
      name: /仕事の変化・周囲との関わり方/,
    });
    const familySupportStyleCard = screen.getByRole("button", {
      name: /家族との距離感・支え合い/,
    });
    const friendshipStyleCard = screen.getByRole("button", {
      name: /友達との距離感・付き合い方/,
    });
    const fallbackCard = screen.getByRole("button", { name: /新しい診断/ });

    expect(conversationEmotionCard.querySelector("img")?.getAttribute("src")).toBe(
      "/images/diagnoses/conversation-emotion.jpg",
    );
    expect(timePlanningCard.querySelector("img")?.getAttribute("src")).toBe(
      "/images/diagnoses/time-planning.jpg",
    );
    expect(lifePrioritiesCard.querySelector("img")?.getAttribute("src")).toBe(
      "/images/diagnoses/life-priorities.jpg",
    );
    expect(workValuesCard.querySelector("img")?.getAttribute("src")).toBe(
      "/images/diagnoses/work-values.jpg",
    );
    expect(workRelationshipStyleCard.querySelector("img")?.getAttribute("src")).toBe(
      "/images/diagnoses/work-relationship-style.jpg",
    );
    expect(familySupportStyleCard.querySelector("img")?.getAttribute("src")).toBe(
      "/images/diagnoses/family-support-style.jpg",
    );
    expect(friendshipStyleCard.querySelector("img")?.getAttribute("src")).toBe(
      "/images/diagnoses/friendship-style.jpg",
    );
    expect(fallbackCard.querySelector("img")?.getAttribute("src")).toBe(
      "/images/diagnoses/default.jpg",
    );
  });
});
