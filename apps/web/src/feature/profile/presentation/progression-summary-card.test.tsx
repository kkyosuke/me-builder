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
    expect(screen.getByText(/優劣や完成度ではなく/)).toBeTruthy();
  });

  it("初回取得中は専用Skeletonを表示する", () => {
    render(<ProgressionSummaryCard state={{ status: "loading" }} />);

    expect(screen.getByRole("status", { name: "うつしレベルを読み込み中" })).toBeTruthy();
  });
});
