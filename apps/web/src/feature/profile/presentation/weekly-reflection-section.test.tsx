// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WeeklyReflectionResult } from "../model/weekly-reflection";
import { WeeklyReflectionSection } from "./weekly-reflection-section";

const result: WeeklyReflectionResult = {
  reflections: [],
  monthlyChanges: [
    {
      month: "2026-08",
      version: 2,
      generatedAt: "2026-08-15T03:00:00.000Z",
      mode: "full",
      headline: "8月は小さな希望を伝えました",
      previousMonthHeadline: "7月は休む時間を確保しました",
      changes: ["8月は小さな希望を伝えました"],
      ongoingGoals: ["次の面談でも希望を一つ伝える"],
      evidenceWeekStarts: ["2026-08-03", "2026-08-10"],
    },
  ],
  generation: {
    weekStart: "2026-08-10",
    status: "completed",
    canGenerate: false,
    message: null,
    notification: "not-applicable",
  },
  canStartNew: true,
};

describe("WeeklyReflectionSection monthly changes", () => {
  afterEach(cleanup);

  it("Fullは前月、継続Goal、根拠週、版を表示する", () => {
    render(
      <WeeklyReflectionSection state={{ status: "success", data: result }} onGenerate={vi.fn()} />,
    );

    expect(screen.getByText("2026-08・第2版")).toBeTruthy();
    expect(screen.getByText("前月: 7月は休む時間を確保しました")).toBeTruthy();
    expect(screen.getByText("次の面談でも希望を一つ伝える")).toBeTruthy();
    expect(screen.getByText(/根拠: 2026-08-03、2026-08-10/)).toBeTruthy();
  });

  it("downgrade後は生成済み結果と短縮表示の説明を残す", () => {
    const monthlyChange = result.monthlyChanges[0];
    if (!monthlyChange) throw new Error("monthly change fixture is required");
    render(
      <WeeklyReflectionSection
        state={{
          status: "success",
          data: {
            ...result,
            monthlyChanges: [{ ...monthlyChange, mode: "archived" }],
          },
        }}
        onGenerate={vi.fn()}
      />,
    );

    expect(screen.getByText("8月は小さな希望を伝えました")).toBeTruthy();
    expect(screen.getByText(/プラン変更前に作成した結果/)).toBeTruthy();
  });
});
