// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosisResult } from "../../model/diagnosis-result";
import { DiagnosisResultView } from "./diagnosis-result";

const resultAnswer = {
  diagnosisQuestionId: "dq-1",
  questionId: "q-1",
  questionVersion: 1,
  questionText: "自分の余裕を優先したい。",
  choiceId: "yes",
  choiceLabel: "はい",
  acceptedAt: "2026-08-05T00:00:00.000Z",
  perspective: "single" as const,
  pairId: null,
};

const result: DiagnosisResult = {
  id: "diagnosis-1",
  title: "価値観診断",
  description: "説明",
  relationshipCategory: "general",
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
        resultKind: "aggregate",
        score: 75,
        coverage: 100,
        band: "high",
        behavior: null,
        comparison: null,
      },
    ],
  },
  answers: [resultAnswer],
};

describe("DiagnosisResultView", () => {
  afterEach(() => cleanup());

  it("傾向スコアを表示し、保存済みの回答内容は初期状態で折りたたむ", () => {
    render(<DiagnosisResultView result={result} onBack={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "価値観診断" })).toBeTruthy();
    expect(screen.getByText("自分自身")).toBeTruthy();
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
    expect(screen.getByRole("link", { name: "わたしのまとめを見る" }).getAttribute("href")).toBe(
      "/me",
    );
  });

  it("表裏質問は普段の行動と大切にしたいことを別々に表示する", () => {
    render(
      <DiagnosisResultView
        result={{
          ...result,
          answeredCount: 2,
          questionCount: 2,
          scoring: {
            scoringVersion: 1,
            balancedLabel: "状況に応じて調整",
            parameters: [
              {
                id: "family_time",
                label: "家族との時間",
                lowLabel: "自分の時間を優先",
                highLabel: "家族との時間を優先",
                resultKind: "behavior_desired",
                score: 100,
                coverage: 100,
                band: "high",
                behavior: { score: 0, coverage: 100, band: "low" },
                comparison: { difference: 100, relation: "desired_higher" },
              },
            ],
          },
          answers: [
            {
              ...resultAnswer,
              perspective: "behavior",
              pairId: "dq-1",
              questionText: "休日は家族と過ごしている。",
              choiceLabel: "いいえ",
            },
            {
              ...resultAnswer,
              diagnosisQuestionId: "dq-2",
              perspective: "desired",
              pairId: "dq-1",
              questionText: "休日は家族と過ごしたい。",
            },
          ],
        }}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText(/回答から見える普段の行動と、大切にしたいこと/)).toBeTruthy();
    expect(
      screen
        .getByRole("meter", { name: "家族との時間・普段の行動の傾向" })
        .getAttribute("aria-valuenow"),
    ).toBe("0");
    expect(
      screen
        .getByRole("meter", { name: "家族との時間・大切にしたいことの傾向" })
        .getAttribute("aria-valuenow"),
    ).toBe("100");
    expect(
      screen.getByText("大切にしたいことの方が、普段の行動より「家族との時間を優先」側です。"),
    ).toBeTruthy();
  });

  it("サマリーから開いた回答結果ではサマリーへの戻り先を表示する", () => {
    render(
      <DiagnosisResultView
        result={result}
        onBack={vi.fn()}
        backHref="/me"
        backLabel="わたしのまとめ"
      />,
    );

    expect(screen.getByRole("link", { name: "わたしのまとめ" }).getAttribute("href")).toBe("/me");
  });

  it("一覧へ戻る操作を通知する", () => {
    const onBack = vi.fn();
    render(<DiagnosisResultView result={result} onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: "診断一覧" }));

    expect(onBack).toHaveBeenCalledOnce();
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

  it("受付終了後の途中回答は閲覧だけを許可し、傾向とまとめ導線を表示しない", () => {
    render(
      <DiagnosisResultView
        result={{
          ...result,
          responseStatus: "in-progress",
          answeredCount: 1,
          questionCount: 3,
        }}
        onBack={vi.fn()}
        progression={{ status: "loading" }}
      />,
    );

    expect(screen.getByText("保存済み回答")).toBeTruthy();
    expect(screen.getByText(/追加回答や結果生成はできません/)).toBeTruthy();
    expect(screen.getByText(/傾向は生成されません/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "回答から見える傾向の一覧" })).toBeNull();
    expect(screen.queryByRole("link", { name: "わたしのまとめを見る" })).toBeNull();
    expect(screen.queryByText("わたしのまとめへの反映")).toBeNull();
  });

  it("回答結果を先に置き、確定したうつしレベルの反映先を案内する", () => {
    render(
      <DiagnosisResultView
        result={result}
        onBack={vi.fn()}
        progression={{
          status: "success",
          data: {
            level: 4,
            growthValue: 46,
            currentLevelThreshold: 45,
            nextLevelThreshold: 80,
            collectedPieces: 8,
            activePieces: 7,
            categoryCount: 3,
            calculationVersion: 1,
            highestLevel: 4,
            isProcessing: false,
            recentChanges: [],
            milestoneCards: [],
          },
        }}
      />,
    );

    const resultHeading = screen.getByRole("heading", { name: "価値観診断" });
    const progressionHeading = screen.getByRole("heading", {
      name: "わたしのまとめへの反映",
    });
    expect(
      resultHeading.compareDocumentPosition(progressionHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(/うつし Lv.4/)).toBeTruthy();
  });

  it("projectionが未確定の間は反映中と案内する", () => {
    render(
      <DiagnosisResultView
        result={result}
        onBack={vi.fn()}
        progression={{
          status: "success",
          data: {
            level: 4,
            growthValue: 46,
            currentLevelThreshold: 45,
            nextLevelThreshold: 80,
            collectedPieces: 8,
            activePieces: 7,
            categoryCount: 3,
            calculationVersion: 1,
            highestLevel: 4,
            isProcessing: true,
            recentChanges: [],
            milestoneCards: [],
          },
        }}
      />,
    );

    expect(screen.getByText("回答から見つかったことを反映しています。")).toBeTruthy();
    expect(screen.queryByText(/うつし Lv.4/)).toBeNull();
  });
});
