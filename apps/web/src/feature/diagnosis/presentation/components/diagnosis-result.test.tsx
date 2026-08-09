// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosisResult } from "../../model/diagnosis-result";
import { DiagnosisResultView } from "./diagnosis-result";

const result: DiagnosisResult = {
  id: "diagnosis-1",
  title: "価値観診断",
  description: "説明",
  responseStatus: "answered",
  answeredCount: 1,
  questionCount: 1,
  scoring: {
    scoringVersion: 1,
    balancedLabel: "状況に応じて調整",
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
      diagnosisQuestionId: "dq-1",
      questionId: "q-1",
      questionVersion: 1,
      questionText: "自分の余裕を優先したい。",
      choiceId: "yes",
      choiceLabel: "はい",
      acceptedAt: "2026-08-05T00:00:00.000Z",
    },
  ],
};

describe("DiagnosisResultView", () => {
  afterEach(() => cleanup());

  it("傾向スコアを表示し、保存済みの回答内容は初期状態で折りたたむ", () => {
    render(<DiagnosisResultView result={result} onBack={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "価値観診断" })).toBeTruthy();
    expect(screen.getByText("優先傾向")).toBeTruthy();
    expect(screen.getByText("相手を優先")).toBeTruthy();
    expect(screen.getAllByText("自分を優先")).toHaveLength(2);
    expect(screen.getByText("1 / 1問に回答")).toBeTruthy();

    const trendList = screen.getByRole("group", { name: "回答から見える傾向の一覧" });
    const trendMeter = screen.getByRole("meter", { name: "優先傾向の傾向" });
    expect(trendList.contains(trendMeter)).toBe(true);
    expect(trendMeter.getAttribute("aria-valuenow")).toBe("75");
    expect(trendMeter.getAttribute("aria-valuetext")).toBe("自分を優先");

    const summary = screen.getByText("回答内容（1件）");
    const details = summary.closest("details");
    expect(details?.open).toBe(false);

    fireEvent.click(summary);

    expect(details?.open).toBe(true);
    expect(screen.getByText("自分の余裕を優先したい。")).toBeTruthy();
    expect(screen.getByText("はい")).toBeTruthy();
  });

  it("一覧へ戻る操作を通知する", () => {
    const onBack = vi.fn();
    render(<DiagnosisResultView result={result} onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: "診断一覧" }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("通常の回答結果からわたしの傾向へ進める", () => {
    render(<DiagnosisResultView result={result} onBack={vi.fn()} showProfileSummaryLink={true} />);

    expect(screen.getByRole("link", { name: "わたしの傾向を見る" }).getAttribute("href")).toBe(
      "/me",
    );
  });

  it("サマリーから開いた結果ではわたしの傾向へのリンクを表示する", () => {
    render(
      <DiagnosisResultView
        result={result}
        onBack={vi.fn()}
        backHref="/me"
        backLabel="わたしの傾向"
      />,
    );

    expect(screen.getByRole("link", { name: "わたしの傾向" }).getAttribute("href")).toBe("/me");
    expect(screen.queryByRole("button", { name: "診断一覧" })).toBeNull();
  });

  it("採点設定がない診断でも回答内容を表示できる", () => {
    render(<DiagnosisResultView result={{ ...result, scoring: null }} onBack={vi.fn()} />);

    expect(
      screen.getByText("保存した回答内容を確認できます。医療的な診断ではありません。"),
    ).toBeTruthy();
    expect(screen.queryByText(/回答から見える現在の傾向です/)).toBeNull();
    expect(screen.getByText(/傾向がまだ設定されていません/)).toBeTruthy();
    expect(screen.getByText("回答内容（1件）")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "回答から見える傾向の一覧" })).toBeNull();
  });
});
