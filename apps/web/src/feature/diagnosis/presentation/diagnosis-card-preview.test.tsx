// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DiagnosisCardPreview from "./diagnosis-card-preview";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DiagnosisCardPreview", () => {
  it("APIへ通信せず、表面の回答から裏面へ進める", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<DiagnosisCardPreview />);

    expect(screen.getByText("DBへ保存しない開発用プレビュー")).toBeTruthy();
    expect(screen.getByLabelText("普段の行動 1/2")).toBeTruthy();

    const frontAnswer = screen
      .getAllByRole<HTMLButtonElement>("button", { name: "はい" })
      .find(({ disabled }) => !disabled);
    if (!frontAnswer) throw new Error("表面の回答ボタンがありません");
    fireEvent.click(frontAnswer);

    await waitFor(() => expect(screen.getByText("2 / 4")).toBeTruthy());
    expect(screen.getAllByLabelText("大切にしたいこと 2/2").length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("あとで回答しても何も保存せず、その場でやり直せる", async () => {
    render(<DiagnosisCardPreview />);

    fireEvent.click(screen.getByRole("button", { name: "あとで回答する" }));

    expect(await screen.findByText("回答を中断しました")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "もう一度試す" }));
    expect(screen.getByLabelText("普段の行動 1/2")).toBeTruthy();
  });
});
