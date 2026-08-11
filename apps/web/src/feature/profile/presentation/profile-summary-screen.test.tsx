// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
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

const pastSummary: ProfileSummary = {
  ...summary,
  generatedAt: "2026-08-02T12:00:00.000Z",
  headline: "以前の記録から見えていたあなたらしさ",
};

const versioning: ProfileSummaryVersioning = {
  versions: [
    {
      id: "version-3",
      sequence: 3,
      generatedAt: "2026-08-09T12:00:00.000Z",
      isLatest: true,
      generationMethod: "ai",
      summary,
    },
    {
      id: "version-2",
      sequence: 2,
      generatedAt: "2026-08-02T12:00:00.000Z",
      isLatest: false,
      generationMethod: "ai",
      summary: pastSummary,
    },
  ],
  selectedVersionId: "version-3",
  generation: {
    status: "idle",
    canRegenerate: true,
    reasons: ["diagnosis", "brain", "format", "elapsed"],
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

  it("過去版の存在を控えめに伝え、カード下から最新のわたしを生成できる", () => {
    vi.useFakeTimers();
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
    expect(screen.getByLabelText("最新のまとめ")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "第3版を表示" })).toBeNull();
    expect(screen.queryByRole("button", { name: "第2版を表示" })).toBeNull();
    expect(screen.getByText(/AI生成/)).toBeTruthy();
    expect(
      screen.getByText(
        /診断が増えました・日記・記録が増えました・まとめの生成内容が更新されました/,
      ),
    ).toBeTruthy();

    const regenerateButton = screen.getByRole("button", { name: "最新のわたしを知る" });
    expect(regenerateButton.className).toContain("w-full");
    expect(regenerateButton.className).not.toContain("absolute");
    fireEvent.click(regenerateButton);
    fireEvent.click(screen.getByRole("button", { name: "過去のまとめがあります" }));
    expect(onSelectVersion).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(320));

    expect(onSelectVersion).toHaveBeenCalledWith("version-2");
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("左右のスワイプは版の移動だけを行う", () => {
    vi.useFakeTimers();
    const onSelectVersion = vi.fn();
    const onRegenerate = vi.fn();
    const { container, rerender } = render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: "chat" } }}
        versioning={versioning}
        onRetry={vi.fn()}
        onSelectVersion={onSelectVersion}
        onRegenerate={onRegenerate}
      />,
    );

    const latestCard = screen.getByLabelText("最新のまとめ");
    firePointer(latestCard, "pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 10,
      pointerId: 1,
    });
    firePointer(latestCard, "pointerup", { clientX: 0, clientY: 12, pointerId: 1 });
    expect(onSelectVersion).not.toHaveBeenCalled();
    act(() => vi.advanceTimersToNextTimer());
    expect(latestCard.getAttribute("style")).toContain("translate3d(-115%");
    expect(container.querySelector('[data-summary-card-layer="incoming"]')?.textContent).toContain(
      pastSummary.headline,
    );
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
    expect(onRegenerate).not.toHaveBeenCalled();
    expect(latestCard.getAttribute("style")).toContain("translate3d(0px");

    rerender(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary: pastSummary, nextAction: "chat" } }}
        versioning={{ ...versioning, selectedVersionId: "version-2" }}
        onRetry={vi.fn()}
        onSelectVersion={onSelectVersion}
        onRegenerate={onRegenerate}
      />,
    );

    const pastCard = screen.getByLabelText("過去のまとめ");
    firePointer(pastCard, "pointerdown", {
      button: 0,
      clientX: 0,
      clientY: 10,
      pointerId: 3,
    });
    firePointer(pastCard, "pointerup", { clientX: 100, clientY: 12, pointerId: 3 });
    act(() => vi.advanceTimersToNextTimer());
    const incomingCard = container.querySelector('[data-summary-card-layer="incoming"]');
    expect(incomingCard?.textContent).toContain("第3版");
    expect(incomingCard?.textContent).toContain(summary.headline);
    expect(incomingCard?.getAttribute("data-summary-card-entry")).toBe("foreground");
    expect(incomingCard?.className).toContain("inset-x-0");
    expect(incomingCard?.className).toContain("z-20");
    act(() => vi.advanceTimersByTime(320));
    expect(onSelectVersion).toHaveBeenLastCalledWith("version-3");
    expect(screen.queryByRole("button", { name: "最新のわたしを知る" })).toBeNull();
  });

  it("ボタンで版を切り替えた後にカードを再アニメーションしない", () => {
    vi.useFakeTimers();

    function VersionHarness() {
      const [selectedVersionId, setSelectedVersionId] = useState("version-3");
      const selectedSummary = selectedVersionId === "version-3" ? summary : pastSummary;
      return (
        <ProfileSummaryScreen
          state={{ status: "success", data: { summary: selectedSummary, nextAction: "chat" } }}
          versioning={{ ...versioning, selectedVersionId }}
          onRetry={vi.fn()}
          onSelectVersion={setSelectedVersionId}
          onRegenerate={vi.fn()}
        />
      );
    }

    const { container } = render(<VersionHarness />);
    const initialLatestCard = screen.getByLabelText("最新のまとめ");
    fireEvent.click(screen.getByRole("button", { name: "過去のまとめがあります" }));
    act(() => vi.advanceTimersToNextTimer());
    act(() => vi.advanceTimersToNextTimer());

    const pastCard = screen.getByLabelText("過去のまとめ");
    expect(pastCard).not.toBe(initialLatestCard);
    expect(container.querySelector('[data-summary-card-layer="incoming"]')).toBeNull();
    expect(pastCard.getAttribute("style")).toContain("translate3d(0px");
    expect(pastCard.className).toContain("duration-0");

    fireEvent.click(screen.getByRole("button", { name: "最新のまとめへ" }));
    act(() => vi.advanceTimersToNextTimer());
    act(() => vi.advanceTimersToNextTimer());

    const latestCard = screen.getByLabelText("最新のまとめ");
    expect(latestCard).not.toBe(pastCard);
    expect(container.querySelector('[data-summary-card-layer="incoming"]')).toBeNull();
    expect(latestCard.getAttribute("style")).toContain("translate3d(0px");
    expect(latestCard.className).toContain("duration-0");

    act(() => vi.advanceTimersByTime(300));
    expect(latestCard.getAttribute("style")).toContain("translate3d(0px");
  });

  it("保存済み版がなくても初回生成中と生成失敗を表示する", () => {
    const onRegenerate = vi.fn();
    const { rerender } = render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary: null, nextAction: "chat" } }}
        versioning={{
          versions: [],
          selectedVersionId: null,
          generation: { status: "generating", canRegenerate: false, reasons: [] },
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "新しい版を作成中" })).toBeTruthy();
    expect(screen.queryByText("まだ、わたしのまとめはありません")).toBeNull();

    rerender(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary: null, nextAction: "chat" } }}
        versioning={{
          versions: [],
          selectedVersionId: null,
          generation: {
            status: "failed",
            canRegenerate: true,
            reasons: [],
            message: "生成に失敗しました",
          },
        }}
        onRetry={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("生成に失敗しました");
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("作成中カードへ再生成元の高さを引き継ぐ", () => {
    function GenerationHarness() {
      const [status, setStatus] = useState<"idle" | "generating">("idle");
      return (
        <ProfileSummaryScreen
          state={{ status: "success", data: { summary, nextAction: "chat" } }}
          versioning={{
            ...versioning,
            generation: { ...versioning.generation, status },
          }}
          onRetry={vi.fn()}
          onSelectVersion={vi.fn()}
          onRegenerate={() => setStatus("generating")}
        />
      );
    }

    render(<GenerationHarness />);
    const latestCard = screen.getByLabelText("最新のまとめ");
    Object.defineProperty(latestCard, "offsetHeight", { configurable: true, value: 640 });
    fireEvent.click(screen.getByRole("button", { name: "最新のわたしを知る" }));

    const generationCard = screen.getByLabelText("新しい版を作成中");
    expect(generationCard.getAttribute("style")).toContain("height: 640px");
    expect(generationCard.className).toContain("w-full");
  });

  it("過去版では生成操作を隠し、生成中も現在の版を閲覧できると伝える", () => {
    vi.useFakeTimers();
    const onSelectVersion = vi.fn();
    const { rerender } = render(
      <ProfileSummaryScreen
        state={{ status: "success", data: { summary, nextAction: "chat" } }}
        versioning={{ ...versioning, selectedVersionId: "version-2" }}
        onRetry={vi.fn()}
        onSelectVersion={onSelectVersion}
        onRegenerate={vi.fn()}
      />,
    );

    expect(screen.getByText("過去のまとめ", { selector: "p" })).toBeTruthy();
    const latestButton = screen.getByRole("button", { name: "最新のまとめへ" });
    fireEvent.click(latestButton);
    const incomingCard = document.querySelector('[data-summary-card-entry="foreground"]');
    expect(incomingCard?.getAttribute("style")).toContain("translate3d(calc(-105%");
    expect(onSelectVersion).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(320));
    expect(onSelectVersion).toHaveBeenCalledWith("version-3");
    expect(screen.queryByRole("button", { name: "最新のわたしを知る" })).toBeNull();

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
    expect(screen.getByLabelText("新しい版を作成中")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("現在の版や過去の版を確認できます");
    expect(screen.queryByRole("button", { name: "最新のわたしを知る" })).toBeNull();
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
