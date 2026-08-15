// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProgressionSummaryCard } from "./progression-summary-card";

describe("ProgressionSummaryCard", () => {
  afterEach(cleanup);

  it("レベル、次のレベルまでの値、かけらと分類を表示する", () => {
    render(
      <ProgressionSummaryCard
        state={{
          status: "success",
          data: {
            level: 12,
            growthValue: 613,
            currentLevelThreshold: 605,
            nextLevelThreshold: 720,
            collectedPieces: 58,
            activePieces: 48,
            categoryCount: 6,
            calculationVersion: 1,
            highestLevel: 12,
            recentChanges: [
              {
                kind: "evidence_deepened",
                growthDelta: 1,
                occurredAt: "2026-08-15T00:00:00.000Z",
              },
            ],
            milestoneCards: [
              {
                level: 10,
                reachedAt: "2026-08-15T00:00:00.000Z",
                collectedPiecesDelta: 42,
                categories: ["identity", "goal"],
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "うつし Lv.12" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "うつしレベル12の進み具合" })).toBeTruthy();
    expect(screen.getByText("107")).toBeTruthy();
    expect(screen.getByText("58")).toBeTruthy();
    expect(screen.getByText("48")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("かけらの根拠が深まりました")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "10レベルごとの成長カード" })).toBeTruthy();
    expect(screen.getByText("Lv.10")).toBeTruthy();
    expect(screen.getByText(/自分らしさ・目標/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    expect(screen.getByText(/優劣や完成度ではなく/)).toBeTruthy();
    expect(screen.queryByText(/me-builder/i)).toBeNull();
  });

  it("初回取得中は専用Skeletonを表示する", () => {
    render(<ProgressionSummaryCard state={{ status: "loading" }} />);

    expect(screen.getByRole("status", { name: "うつしレベルを読み込み中" })).toBeTruthy();
    expect(document.querySelector('[data-skeleton-region="progression-card"]')).toBeTruthy();
  });
});
