// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CompatibilityResultApplication from "./compatibility-result-application";

const mocks = vi.hoisted(() => ({ useCompatibilityRelationship: vi.fn() }));

vi.mock("../../liff", () => ({ useLiffSession: () => ({ acquireIdToken: vi.fn() }) }));
vi.mock("./hooks/use-compatibility-relationship", () => ({
  useCompatibilityRelationship: mocks.useCompatibilityRelationship,
}));

const relationshipId = "1".repeat(64);

function renderWaiting(nextAction: "diagnosis" | "profile-summary" | null) {
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
    ending: { status: "idle" },
    reload: vi.fn(),
    end: vi.fn(),
  });
  render(<CompatibilityResultApplication relationshipId={relationshipId} />);
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
    expect(screen.queryByRole("link", { name: "診断を見る" })).toBeNull();
  });

  it("共通の診断テーマがなければ診断へ案内する", () => {
    renderWaiting("diagnosis");

    expect(screen.getByText(/共通の診断テーマがまだありません/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "診断を見る" }).getAttribute("href")).toBe(
      "/diagnosis",
    );
  });

  it("共有できる「私について」がなければわたしのまとめへ案内する", () => {
    renderWaiting("profile-summary");

    expect(screen.getByText(/「私について」がまだありません/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "わたしの傾向を作る" }).getAttribute("href")).toBe(
      "/me",
    );
  });
});
