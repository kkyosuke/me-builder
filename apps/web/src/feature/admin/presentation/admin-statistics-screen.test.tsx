// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminStatisticsScreen } from "./admin-statistics-screen";

describe("AdminStatisticsScreen", () => {
  afterEach(cleanup);

  it("統計情報の取得中は画面構造に沿ったSkeletonを表示する", () => {
    render(<AdminStatisticsScreen state={{ status: "loading" }} onReload={vi.fn()} />);

    expect(screen.getByRole("status", { name: "統計情報を読み込み中" })).toBeTruthy();
  });

  it("統計取得に失敗したら再読み込みできる", () => {
    const onReload = vi.fn();
    render(
      <AdminStatisticsScreen
        state={{ status: "error", message: "取得に失敗しました" }}
        onReload={onReload}
      />,
    );

    expect(screen.getByText("取得に失敗しました")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(onReload).toHaveBeenCalledOnce();
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
              requestCount: 0,
              inputTokens: 0,
              outputTokens: 0,
              costEstimate: {
                status: "available",
                currency: "USD",
                amount: 0,
                pricingAsOf: "2026-08-15",
              },
              accounts: [],
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
              requestCount: 12,
              inputTokens: 0,
              outputTokens: 0,
              costEstimate: {
                status: "available",
                currency: "USD",
                amount: 0,
                pricingAsOf: "2026-08-15",
              },
              accounts: [
                {
                  accountId: "account-1",
                  requestCount: 12,
                  inputTokens: 0,
                  outputTokens: 0,
                  estimatedCostUsd: 0,
                },
              ],
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
    expect(screen.getByText(/取得時刻:.*2026\/8\/8/)).toBeTruthy();
    expect(screen.getByText(/表示値は直前の取得結果です/)).toBeTruthy();
    expect(screen.getAllByText("12")).toHaveLength(2);
    expect(screen.getByText("account-1")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "統計情報を更新中" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("狭い画面ではAccount別利用量だけを横スクロールできる", () => {
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
              requestCount: 1,
              inputTokens: 2,
              outputTokens: 3,
              costEstimate: {
                status: "available",
                currency: "USD",
                amount: 0.0000081,
                pricingAsOf: "2026-08-15",
              },
              accounts: [
                {
                  accountId: "very-long-account-id-that-must-not-expand-the-dashboard",
                  requestCount: 1,
                  inputTokens: 2,
                  outputTokens: 3,
                  estimatedCostUsd: 0.0000081,
                },
              ],
            },
            line: {
              status: "available",
              billableMessages: 0,
              monthlyLimit: 5000,
              replyMessages: 0,
            },
          },
        }}
        onReload={vi.fn()}
      />,
    );

    const scrollRegion = screen.getByRole("region", {
      name: "Account別利用量。横にスクロールできます",
    });
    expect(scrollRegion.classList.contains("max-w-full")).toBe(true);
    expect(scrollRegion.classList.contains("overflow-x-auto")).toBe(true);
    expect(scrollRegion.parentElement?.closest("section")?.classList.contains("min-w-0")).toBe(
      true,
    );
  });

  it("Geminiの概算料金と実請求額ではない旨を表示する", () => {
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
              requestCount: 1,
              inputTokens: 100,
              outputTokens: 20,
              costEstimate: {
                status: "available",
                currency: "USD",
                amount: 0.00008,
                pricingAsOf: "2026-08-15",
              },
              accounts: [
                {
                  accountId: "account-1",
                  requestCount: 1,
                  inputTokens: 100,
                  outputTokens: 20,
                  estimatedCostUsd: 0.00008,
                },
              ],
            },
            line: {
              status: "available",
              billableMessages: 0,
              monthlyLimit: 5000,
              replyMessages: 0,
            },
          },
        }}
        onReload={vi.fn()}
      />,
    );

    expect(screen.getAllByText("$0.00008")).toHaveLength(2);
    expect(screen.getByText(/実請求額とは異なります/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Google公式料金表" })).toBeTruthy();
  });

  it("概算料金を算出できない理由を区別して表示する", () => {
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
              requestCount: 2,
              inputTokens: 100,
              outputTokens: 20,
              costEstimate: {
                status: "unavailable",
                issues: [
                  { reason: "unsupported-model", models: ["gemini-future"] },
                  { reason: "invalid-usage", models: ["gemini-3.5-flash-lite-001"] },
                ],
              },
              accounts: [],
            },
            line: {
              status: "available",
              billableMessages: 0,
              monthlyLimit: 5000,
              replyMessages: 0,
            },
          },
        }}
        onReload={vi.fn()}
      />,
    );

    expect(screen.getByText(/単価未対応モデル: gemini-future/)).toBeTruthy();
    expect(screen.getByText(/不正なtoken利用量: gemini-3.5-flash-lite-001/)).toBeTruthy();
  });
});
