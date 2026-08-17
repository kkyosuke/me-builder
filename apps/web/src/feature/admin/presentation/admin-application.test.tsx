// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminApplication from "./admin-application";

vi.mock("./admin-accounts-screen", () => ({
  AdminAccountsScreen: () => <section>アカウント一覧</section>,
}));

vi.mock("./admin-statistics-screen", () => ({
  AdminStatisticsScreen: () => <section>統計内容</section>,
}));

vi.mock("./use-admin-accounts", () => ({
  useAdminAccounts: () => ({
    state: { status: "loading" },
    filters: { query: "", role: "all", status: "all", sort: "created" },
    isRefreshing: false,
    pageNumber: 1,
    canGoBack: false,
    reload: vi.fn(),
    updateFilter: vi.fn(),
    nextPage: vi.fn(),
    previousPage: vi.fn(),
  }),
}));

vi.mock("./use-admin-statistics", () => ({
  useAdminStatistics: () => ({
    state: { status: "loading" },
    isRefreshing: false,
    reload: vi.fn(),
  }),
}));

describe("AdminApplication", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("タブ切り替え時も共通ヘッダーを維持する", async () => {
    window.history.replaceState({}, "", "/admin");
    render(<AdminApplication />);

    const heading = screen.getByRole("heading", { name: "管理者ダッシュボード" });
    const header = heading.closest("header");
    expect(header).not.toBeNull();
    expect(screen.getByRole("link", { name: "アカウント" }).getAttribute("href")).toBe("/admin");
    expect(screen.getByText("アカウント一覧")).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "利用統計" }));

    await waitFor(() => expect(screen.getByText("統計内容")).toBeTruthy());
    expect(window.location.pathname).toBe("/admin/statistics");
    expect(screen.getByRole("heading", { name: "管理者ダッシュボード" }).closest("header")).toBe(
      header,
    );
    expect(screen.getByRole("link", { name: "利用統計" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });
});
