// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiagnosisDetailSkeleton } from "./diagnosis-loading-skeleton";

describe("DiagnosisDetailSkeleton", () => {
  afterEach(cleanup);

  it("診断詳細の取得中であることを支援技術へ通知する", () => {
    render(<DiagnosisDetailSkeleton />);

    expect(screen.getByRole("status", { name: "診断詳細を読み込み中" })).toBeTruthy();
  });
});
