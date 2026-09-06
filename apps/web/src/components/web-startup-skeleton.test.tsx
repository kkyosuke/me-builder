// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WebStartupSkeleton } from "./web-startup-skeleton";

describe("WebStartupSkeleton", () => {
  afterEach(cleanup);

  it("診断ルートでは最終画面と同じ見出しを通信前から表示する", () => {
    render(<WebStartupSkeleton route="diagnosis" />);

    expect(screen.getByRole("heading", { name: "わたしの診断" })).toBeTruthy();
    expect(screen.getByText("答えられる診断を準備しています。")).toBeTruthy();
  });

  it("要求されたルートに合わせて骨格の内容を変える", () => {
    render(<WebStartupSkeleton route="me" />);

    expect(screen.getByRole("heading", { name: "わたしのまとめ" })).toBeTruthy();
    expect(screen.getByText("これまでに見つかったことを準備しています。")).toBeTruthy();
  });

  it("規約導線では診断画面ではなく利用規約の骨格を表示する", () => {
    render(<WebStartupSkeleton route="terms" />);

    expect(screen.getByRole("heading", { name: "利用規約" })).toBeTruthy();
    expect(screen.getByText("現在の利用条件を確認しています。")).toBeTruthy();
  });
});
