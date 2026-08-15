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
      id: "account-user",
      displayName: "山田 花子",
      role: "user",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
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
      id: "account-admin",
      displayName: null,
      role: "admin",
      status: "active",
      createdAt: "2026-07-01T00:00:00.000Z",
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

  it("名前、ID、レベル、かけら、未集計状態を表示する", () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "管理者ダッシュボード" })).toBeTruthy();
    expect(screen.getAllByText("山田 花子").length).toBeGreaterThan(0);
    expect(screen.getAllByText("account-user").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Lv.12").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/集計更新/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("レベル集計中").length).toBeGreaterThan(0);
    expect(screen.queryByText("UIプレビュー用のサンプルデータです")).toBeNull();
  });

  it("検索と絞り込みをAPI取得側へ通知する", () => {
    const onFilterChange = vi.fn();
    renderScreen({ onFilterChange });

    fireEvent.change(screen.getByRole("searchbox", { name: "名前・Account IDを検索" }), {
      target: { value: "山田" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "roleで絞り込み" }), {
      target: { value: "admin" },
    });
    expect(onFilterChange).toHaveBeenNthCalledWith(1, "query", "山田");
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

  it("一覧取得に失敗しても利用統計へ移動できる", () => {
    renderScreen({ state: { status: "error", message: "取得に失敗しました" } });

    expect(screen.getByText("取得に失敗しました")).toBeTruthy();
    expect(screen.getByRole("link", { name: "利用統計" }).getAttribute("href")).toBe(
      "/admin/statistics",
    );
  });
});
