// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileSummary } from "../model/profile-summary";
import { ProfileSummaryScreen } from "./profile-summary-screen";

const summary: ProfileSummary = {
  generatedAt: "2026-08-08T12:00:00.000Z",
  headline: "最近の記録から、こんなあなたらしさが見えています",
  insights: [
    {
      key: "prepare",
      label: "見通しを持って動く",
      description: "先の段取りが見えると安心して力を発揮できる傾向があります。",
      evidenceCount: 1,
      sources: ["diagnosis"],
    },
  ],
  themes: [
    {
      diagnosisId: "time-planning",
      title: "時間と予定",
      answerCount: 2,
      lastAnsweredAt: "2026-08-08T11:45:00.000Z",
      scoring: {
        balancedLabel: "状況による",
        parameters: [
          {
            id: "planning",
            label: "計画",
            lowLabel: "その場で決める",
            highLabel: "前もって決める",
            score: 80,
            coverage: 100,
            evidenceCount: 1,
            band: "high",
          },
        ],
      },
    },
  ],
  diaryMemories: [
    {
      id: "memory-1",
      statement: "公開予定を一週間延期した",
      recordedAt: "2026-08-08T11:50:00.000Z",
      evidenceCount: 2,
    },
  ],
  recordCount: 2,
  diagnosisCount: 1,
  diaryCount: 1,
  latestRecordedAt: "2026-08-08T11:50:00.000Z",
};

describe("ProfileSummaryScreen", () => {
  afterEach(() => cleanup());

  it("生成したまとめ、根拠、入力範囲を表示する", () => {
    render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: "diagnosis" } }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "わたしの傾向" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "見通しを持って動く" })).toBeTruthy();
    expect(screen.getByText("診断", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("2件")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "時間と予定" })).toBeTruthy();
    expect(screen.getByRole("meter", { name: "計画の傾向" })).toBeTruthy();
    expect(screen.getByText("回答充足度 100%・根拠 1回答")).toBeTruthy();
    expect(screen.getByRole("link", { name: "回答結果を見る" }).getAttribute("href")).toBe(
      "/diagnosis?result=time-planning&from=profile",
    );
    expect(screen.getByRole("link", { name: "未回答の診断を見る" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "日記からの記録" })).toBeTruthy();
    expect(screen.getByText("公開予定を一週間延期した")).toBeTruthy();
    expect(screen.getByText("根拠 2発言")).toBeTruthy();
    expect(screen.getByText("日記・AI抽出")).toBeTruthy();
    expect(screen.getByRole("link", { name: "わたし" }).getAttribute("aria-current")).toBe("page");
  });

  it("未回答の診断がなければ次の診断導線を表示しない", () => {
    render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: null } }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole("link", { name: "未回答の診断を見る" })).toBeNull();
  });

  it("まとめがなければ診断を案内する", () => {
    render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary: null, nextAction: "diagnosis" } }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "まだ、わたしのまとめはありません" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "診断を始める" })).toBeTruthy();
    expect(screen.queryByText("LINEで今日のことを話してみる")).toBeNull();
  });

  it("生成失敗時に再試行できる", () => {
    const onRetry = vi.fn();
    render(
      <ProfileSummaryScreen
        state={{ status: "error", message: "LINEから開き直してください。" }}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("LINEから開き直してください。")).toBeTruthy();
    expect(screen.getByRole("link", { name: "診断一覧を見る" }).getAttribute("href")).toBe(
      "/diagnosis",
    );
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
