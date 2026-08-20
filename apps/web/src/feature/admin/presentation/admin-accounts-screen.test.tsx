// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminAccountPage } from "../model/account";
import { AdminAccountsScreen } from "./admin-accounts-screen";

const page: AdminAccountPage = {
  total: 2,
  nextCursor: null,
  accounts: [
    {
      adminReference: "account_0123456789abcdef01234567",
      role: "user",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
      lastActivityAt: "2026-08-14T00:02:00.000Z",
      plan: "free",
      progression: {
        status: "ready",
        level: 12,
        calculationVersion: 1,
        collectedPieces: 58,
        activePieces: 48,
        lastGrowthAt: "2026-08-14T00:00:00.000Z",
        projectedAt: "2026-08-14T00:01:00.000Z",
      },
    },
    {
      adminReference: "account_89abcdef0123456789abcdef",
      role: "admin",
      status: "active",
      createdAt: "2026-07-01T00:00:00.000Z",
      lastActivityAt: "2026-07-02T00:00:00.000Z",
      plan: "free",
      progression: { status: "pending" },
    },
  ],
};

const filters = { query: "", role: "all", status: "all", sort: "created" } as const;

function renderScreen(overrides: Partial<Parameters<typeof AdminAccountsScreen>[0]> = {}) {
  return render(
    <AdminAccountsScreen
      state={{ status: "success", data: page }}
      filters={filters}
      onReload={vi.fn()}
      onFilterChange={vi.fn()}
      onNextPage={vi.fn()}
      onPreviousPage={vi.fn()}
      {...overrides}
    />,
  );
}

describe("AdminAccountsScreen", () => {
  afterEach(cleanup);

  it("仮名管理参照、Plan、レベル、かけら、未集計状態を表示する", () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "Account" })).toBeTruthy();
    expect(screen.getAllByText("account_0123456789abcdef01234567").length).toBeGreaterThan(0);
    expect(screen.queryByText("山田 花子")).toBeNull();
    expect(screen.getAllByText("Lv.12").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/集計更新/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("レベル集計中").length).toBeGreaterThan(0);
    expect(screen.queryByText("UIプレビュー用のサンプルデータです")).toBeNull();
  });

  it("検索と絞り込みをAPI取得側へ通知する", () => {
    const onFilterChange = vi.fn();
    renderScreen({ onFilterChange });

    fireEvent.change(screen.getByRole("searchbox", { name: "管理参照を完全一致で検索" }), {
      target: { value: "account_0123456789abcdef01234567" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "roleで絞り込み" }), {
      target: { value: "admin" },
    });
    expect(onFilterChange).toHaveBeenNthCalledWith(1, "query", "account_0123456789abcdef01234567");
    expect(onFilterChange).toHaveBeenNthCalledWith(2, "role", "admin");
  });

  it("cursorページの前後移動を通知する", () => {
    const onNextPage = vi.fn();
    const onPreviousPage = vi.fn();
    renderScreen({
      state: { status: "success", data: { ...page, nextCursor: "next" } },
      pageNumber: 2,
      canGoBack: true,
      onNextPage,
      onPreviousPage,
    });

    fireEvent.click(screen.getByRole("button", { name: "前のページ" }));
    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    expect(onPreviousPage).toHaveBeenCalledOnce();
    expect(onNextPage).toHaveBeenCalledOnce();
  });

  it("一覧取得に失敗したら再読み込みできる", () => {
    const onReload = vi.fn();
    renderScreen({ state: { status: "error", message: "取得に失敗しました" }, onReload });

    expect(screen.getByText("取得に失敗しました")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});
