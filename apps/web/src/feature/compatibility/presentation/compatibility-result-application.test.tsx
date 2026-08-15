// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CompatibilityResultApplication from "./compatibility-result-application";

const mocks = vi.hoisted(() => ({
  preloadCompatibilityRoute: vi.fn(),
  useCompatibilityRelationship: vi.fn(),
}));

vi.mock("../../liff", () => ({ useLiffSession: () => ({ acquireIdToken: vi.fn() }) }));
vi.mock("./hooks/use-compatibility-relationship", () => ({
  useCompatibilityRelationship: mocks.useCompatibilityRelationship,
}));
vi.mock("./compatibility-route-loaders", () => ({
  preloadCompatibilityRoute: mocks.preloadCompatibilityRoute,
}));

const relationshipId = "1".repeat(64);

function renderWaiting(
  nextAction: "diagnosis" | "profile-summary" | null,
  ending: { status: "idle" } | { status: "success"; data: null } = { status: "idle" },
) {
  const end = vi.fn();
  mocks.useCompatibilityRelationship.mockReturnValue({
    state: {
      status: "success",
      data: {
        relationshipId,
        status: "waiting",
        relationshipCategory: "partner",
        nextAction,
      },
    },
    ending,
    reload: vi.fn(),
    end,
  });
  render(<CompatibilityResultApplication relationshipId={relationshipId} />);
  return { end };
}

describe("CompatibilityResultApplication waiting state", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("相手側の準備だけが足りない場合は、自分への操作を促さない", () => {
    renderWaiting(null);

    expect(screen.getByRole("heading", { name: "相手の準備を待っています" })).toBeTruthy();
    expect(screen.getByText(/あなたの共有内容はそろっています/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "相性一覧へ戻る" }).getAttribute("href")).toBe(
      "/compatibility",
    );
    fireEvent.pointerEnter(screen.getByRole("link", { name: "相性一覧へ戻る" }));
    expect(mocks.preloadCompatibilityRoute).toHaveBeenCalledWith("list");
    expect(screen.queryByRole("link", { name: "診断を見る" })).toBeNull();
  });

  it("共通の診断テーマがなければ診断へ案内する", () => {
    renderWaiting("diagnosis");

    expect(screen.getByText(/共通の診断テーマがまだありません/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "診断を見る" }).getAttribute("href")).toBe(
      "/diagnosis?category=partner",
    );
  });

  it("共有できる「私について」がなければわたしのまとめへ案内する", () => {
    renderWaiting("profile-summary");

    expect(screen.getByText(/「私について」がまだありません/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "わたしの傾向を作る" }).getAttribute("href")).toBe(
      "/me?shareCategory=partner",
    );
  });

  it("準備中でも確認後に共有を終了できる", () => {
    const { end } = renderWaiting(null);

    fireEvent.click(screen.getByRole("button", { name: "共有を終了する" }));
    expect(screen.getByText(/2人ともこの相性シートを見られなくなります/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "共有を終了" }));
    expect(end).toHaveBeenCalledOnce();
  });

  it("準備中の共有終了後も完了画面から一覧へ戻れる", () => {
    renderWaiting(null, { status: "success", data: null });

    expect(screen.getByRole("heading", { name: "共有を終了しました" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "相性一覧へ戻る" }).getAttribute("href")).toBe(
      "/compatibility",
    );
  });
});
