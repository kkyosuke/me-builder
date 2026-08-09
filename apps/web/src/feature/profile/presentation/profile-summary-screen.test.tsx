// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileSummary, ProfileSummaryVersioning } from "../model/profile-summary";
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

const versioning: ProfileSummaryVersioning = {
  versions: [
    {
      id: "version-3",
      sequence: 3,
      generatedAt: "2026-08-09T12:00:00.000Z",
      isLatest: true,
      generationMethod: "ai",
    },
    {
      id: "version-2",
      sequence: 2,
      generatedAt: "2026-08-02T12:00:00.000Z",
      isLatest: false,
      generationMethod: "ai",
    },
  ],
  selectedVersionId: "version-3",
  generation: {
    status: "idle",
    canRegenerate: true,
    reasons: ["diagnosis", "brain", "elapsed"],
  },
};

describe("ProfileSummaryScreen", () => {
  afterEach(cleanup);

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

  it("右上で過去版を選択し、最新版を再生成できる", () => {
    const onSelectVersion = vi.fn();
    const onRegenerate = vi.fn();
    render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: "chat" } }}
        versioning={versioning}
        onRetry={vi.fn()}
        onSelectVersion={onSelectVersion}
        onRegenerate={onRegenerate}
      />,
    );

    const selector = screen.getByLabelText("表示する版");
    expect(screen.getByRole("option", { name: /第3版/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /第2版/ })).toBeTruthy();
    expect(screen.getByText(/AI生成/)).toBeTruthy();
    expect(screen.getByText("診断が増えました")).toBeTruthy();
    expect(screen.getByText("日記・記録が増えました")).toBeTruthy();
    expect(screen.getByText("前回の生成から時間が経ちました")).toBeTruthy();

    fireEvent.change(selector, { target: { value: "version-2" } });
    fireEvent.click(screen.getByRole("button", { name: "まとめを更新" }));

    expect(onSelectVersion).toHaveBeenCalledWith("version-2");
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("過去版では再生成を無効にし、生成中も現在の版を閲覧できると伝える", () => {
    const { rerender } = render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: "chat" } }}
        versioning={{ ...versioning, selectedVersionId: "version-2" }}
        onRetry={vi.fn()}
        onSelectVersion={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    expect(
      screen.getByText("過去の版を表示中です。更新するには最新版へ戻ってください。"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "まとめを更新" }).hasAttribute("disabled")).toBe(
      true,
    );

    rerender(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: "chat" } }}
        versioning={{
          ...versioning,
          generation: { ...versioning.generation, status: "generating" },
        }}
        onRetry={vi.fn()}
        onSelectVersion={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("現在の版や過去の版を確認できます");
    expect(screen.getByRole("button", { name: "新しい版を作成中" }).hasAttribute("disabled")).toBe(
      true,
    );
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
