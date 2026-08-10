// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminStatisticsScreen } from "./admin-statistics-screen";

describe("AdminStatisticsScreen", () => {
  afterEach(cleanup);

  it("統計情報の取得中は画面構造に沿ったSkeletonを表示する", () => {
    render(<AdminStatisticsScreen state={{ status: "loading" }} onReload={vi.fn()} />);

    expect(screen.getByRole("status", { name: "統計情報を読み込み中" })).toBeTruthy();
  });

  it("LINE返信数が前日までの集計であることを表示する", () => {
    render(
      <AdminStatisticsScreen
        state={{
          status: "success",
          data: {
            period: {
              start: "2026-08-01T00:00:00.000Z",
              end: "2026-08-08T00:00:00.000Z",
            },
            fetchedAt: "2026-08-08T00:00:00.000Z",
            gemini: {
              status: "available",
              estimatedCostUsd: 0,
              requestCount: 0,
              inputTokens: 0,
              outputTokens: 0,
            },
            line: {
              status: "available",
              billableMessages: 0,
              monthlyLimit: 5000,
              replyMessages: 3,
            },
          },
        }}
        onReload={vi.fn()}
      />,
    );

    expect(screen.getByText("返信送信数（前日まで）")).toBeTruthy();
  });

  it("更新中もヘッダーと現在の統計を表示する", () => {
    render(
      <AdminStatisticsScreen
        state={{
          status: "success",
          data: {
            period: {
              start: "2026-08-01T00:00:00.000Z",
              end: "2026-08-08T00:00:00.000Z",
            },
            fetchedAt: "2026-08-08T00:00:00.000Z",
            gemini: {
              status: "available",
              estimatedCostUsd: 0,
              requestCount: 12,
              inputTokens: 0,
              outputTokens: 0,
            },
            line: {
              status: "available",
              billableMessages: 0,
              monthlyLimit: 5000,
              replyMessages: 3,
            },
          },
        }}
        isRefreshing
        onReload={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "利用統計" })).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "統計情報を更新中" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
