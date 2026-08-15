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

describe("AdminAccountsScreen", () => {
  afterEach(cleanup);

  it("名前、ID、レベル、かけら、未集計状態を表示する", () => {
    render(<AdminAccountsScreen state={{ status: "success", data: page }} onReload={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "管理者ダッシュボード" })).toBeTruthy();
    expect(screen.getAllByText("山田 花子").length).toBeGreaterThan(0);
    expect(screen.getAllByText("account-user").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Lv.12").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/集計更新/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("レベル集計中").length).toBeGreaterThan(0);
    expect(screen.getByText("UIプレビュー用のサンプルデータです")).toBeTruthy();
  });

  it("表示名の部分一致とroleで一覧を絞り込む", () => {
    render(<AdminAccountsScreen state={{ status: "success", data: page }} onReload={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "名前・Account IDを検索" }), {
      target: { value: "山田" },
    });
    expect(screen.getAllByText("山田 花子").length).toBeGreaterThan(0);
    expect(screen.queryByText("名前未取得")).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "roleで絞り込み" }), {
      target: { value: "admin" },
    });
    expect(screen.getByText("条件に一致するAccountはありません")).toBeTruthy();
  });
});
