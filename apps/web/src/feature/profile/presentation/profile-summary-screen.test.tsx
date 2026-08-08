// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
      evidenceCount: 2,
      sources: ["diagnosis", "diary"],
    },
  ],
  recordCount: 2,
  diagnosisCount: 1,
  diaryCount: 1,
  latestRecordedAt: "2026-08-08T11:45:00.000Z",
};

describe("ProfileSummaryScreen", () => {
  it("生成したまとめ、根拠、入力範囲を表示する", () => {
    render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: "diagnosis" } }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "わたしのまとめ" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "見通しを持って動く" })).toBeTruthy();
    expect(screen.getByText("診断", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("日記", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("2件")).toBeTruthy();
    expect(screen.getByRole("link", { name: "未回答の診断を見る" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "わたし" }).getAttribute("aria-current")).toBe("page");
  });

  it("未回答の診断がなければ毎日の会話を促す", () => {
    render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: "chat" } }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText(/毎日の会話で/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "未回答の診断を見る" })).toBeNull();
  });

  it("まとめがなければ診断とLINEの会話を案内する", () => {
    render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary: null, nextAction: "diagnosis" } }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "まだ、わたしのまとめはありません" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "診断を始める" })).toBeTruthy();
    expect(screen.getByText("LINEで今日のことを話してみる")).toBeTruthy();
  });

  it("生成失敗時に再試行できる", () => {
    const onRetry = vi.fn();
    render(
      <ProfileSummaryScreen state={{ status: "error", message: "failed" }} onRetry={onRetry} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
