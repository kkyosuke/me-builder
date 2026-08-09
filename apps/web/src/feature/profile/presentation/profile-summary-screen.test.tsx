// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileSummary, ProfileSummaryVersioning } from "../model/profile-summary";
import { ProfileSummaryScreen } from "./profile-summary-screen";

function firePointer(
  target: Element,
  type: "pointerdown" | "pointerup",
  values: { button?: number; clientX: number; clientY: number; pointerId: number },
) {
  const event = new Event(type, { bubbles: true });
  for (const [key, value] of Object.entries({ isPrimary: true, ...values })) {
    Object.defineProperty(event, key, { value });
  }
  fireEvent(target, event);
}

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
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("初回読み込み中はまとめカードのスケルトンを表示する", () => {
    render(<ProfileSummaryScreen state={{ status: "loading" }} onRetry={vi.fn()} />);

    expect(screen.getByRole("status", { name: "わたしのまとめを読み込み中" })).toBeTruthy();
    expect(screen.queryByText("記録からまとめを作っています...")).toBeNull();
  });

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
    expect(screen.getByRole("heading", { name: "まとめに使えるもの" })).toBeTruthy();
    expect(screen.getAllByText("現在 1件")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "未回答の診断を見る" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "わたし" }).getAttribute("aria-current")).toBe("page");
  });

  it("表示中の版の参照件数とは別に、現在まとめに使える件数を表示する", () => {
    render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: "chat" } }}
        availableDataCounts={{ diagnosis: 4, diary: 12 }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("現在 4件")).toBeTruthy();
    expect(screen.getByText("現在 12件")).toBeTruthy();
    expect(screen.queryByText(/件を参照/)).toBeNull();
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

  it("カードスタックから過去版を選び、新しい版の生成をボタンでも要求できる", () => {
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

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByLabelText("第3版、1/2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "第3版を表示" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "第2版を表示" })).toBeTruthy();
    expect(screen.getByText(/AI生成/)).toBeTruthy();
    expect(screen.getByText(/診断が増えました・日記・記録が増えました/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "第2版を表示" }));
    fireEvent.click(screen.getByRole("button", { name: "新しい私を見る" }));

    expect(onSelectVersion).toHaveBeenCalledWith("version-2");
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("左右のスワイプで版を移動し、右スワイプで新しい版を生成する", () => {
    vi.useFakeTimers();
    const onSelectVersion = vi.fn();
    const onRegenerate = vi.fn();
    const { rerender } = render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: "chat" } }}
        versioning={versioning}
        onRetry={vi.fn()}
        onSelectVersion={onSelectVersion}
        onRegenerate={onRegenerate}
      />,
    );

    const latestCard = screen.getByLabelText("第3版、1/2");
    firePointer(latestCard, "pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 10,
      pointerId: 1,
    });
    firePointer(latestCard, "pointerup", { clientX: 0, clientY: 12, pointerId: 1 });
    expect(onSelectVersion).not.toHaveBeenCalled();
    expect(latestCard.getAttribute("style")).toContain("translate3d(-115%");
    act(() => vi.advanceTimersByTime(300));
    expect(onSelectVersion).toHaveBeenCalledWith("version-2");
    expect(latestCard.getAttribute("style")).toContain("translate3d(0px");
    expect(latestCard.className).toContain("duration-0");

    firePointer(latestCard, "pointerdown", {
      button: 0,
      clientX: 0,
      clientY: 10,
      pointerId: 2,
    });
    firePointer(latestCard, "pointerup", { clientX: 100, clientY: 12, pointerId: 2 });
    expect(screen.getByText("新しい版を追加しています")).toBeTruthy();
    expect(onRegenerate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onRegenerate).toHaveBeenCalledOnce();

    rerender(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: "chat" } }}
        versioning={{ ...versioning, selectedVersionId: "version-2" }}
        onRetry={vi.fn()}
        onSelectVersion={onSelectVersion}
        onRegenerate={onRegenerate}
      />,
    );

    const pastCard = screen.getByLabelText("第2版、2/2");
    firePointer(pastCard, "pointerdown", {
      button: 0,
      clientX: 0,
      clientY: 10,
      pointerId: 3,
    });
    firePointer(pastCard, "pointerup", { clientX: 100, clientY: 12, pointerId: 3 });
    act(() => vi.advanceTimersByTime(300));
    expect(onSelectVersion).toHaveBeenLastCalledWith("version-3");
    expect(screen.queryByRole("button", { name: "新しい私を見る" })).toBeNull();
  });

  it("過去版では生成操作を隠し、生成中も現在の版を閲覧できると伝える", () => {
    const { rerender } = render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: "chat" } }}
        versioning={{ ...versioning, selectedVersionId: "version-2" }}
        onRetry={vi.fn()}
        onSelectVersion={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    expect(screen.getByText("左右のスワイプで版を移動")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "新しい私を見る" })).toBeNull();

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

    expect(screen.getByRole("heading", { name: "新しい版を作成中" })).toBeTruthy();
    expect(screen.getByLabelText("新しい版を作成中、1/2")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("現在の版や過去の版を確認できます");
    expect(screen.queryByRole("button", { name: "新しい私を見る" })).toBeNull();
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
