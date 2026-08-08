// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminStatisticsScreen } from "./admin-statistics-screen";

describe("AdminStatisticsScreen", () => {
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
});
