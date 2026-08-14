// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainNavigation } from "./main-navigation";

const mocks = vi.hoisted(() => ({
  preloadMainApplication: vi.fn(),
}));

vi.mock("../routes", () => ({
  preloadMainApplication: mocks.preloadMainApplication,
}));

describe("MainNavigation", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("通常のタップでは文書を再読み込みせず履歴と表示ルートを更新する", () => {
    window.history.replaceState({}, "", "/me");
    const handlePopState = vi.fn();
    window.addEventListener("popstate", handlePopState);
    render(<MainNavigation current="me" />);

    expect(fireEvent.click(screen.getByRole("link", { name: "診断" }))).toBe(false);
    expect(window.location.pathname).toBe("/diagnosis");
    expect(handlePopState).toHaveBeenCalledTimes(1);

    window.removeEventListener("popstate", handlePopState);
  });

  it("現在の項目を押しても再読み込みしない", () => {
    window.history.replaceState({}, "", "/me");
    render(<MainNavigation current="me" />);

    expect(fireEvent.click(screen.getByRole("link", { name: "わたし" }))).toBe(false);
    expect(window.location.pathname).toBe("/me");
  });

  it("移動先へポインターまたはフォーカスを向けた時だけ先読みする", () => {
    render(<MainNavigation current="me" />);

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "わたし",
      "診断",
      "相性",
    ]);

    fireEvent.pointerEnter(screen.getByRole("link", { name: "わたし" }));
    expect(mocks.preloadMainApplication).not.toHaveBeenCalled();

    const diagnosisLink = screen.getByRole("link", { name: "診断" });
    fireEvent.pointerEnter(diagnosisLink);
    fireEvent.focus(diagnosisLink);
    expect(mocks.preloadMainApplication).toHaveBeenNthCalledWith(1, "diagnosis");
    expect(mocks.preloadMainApplication).toHaveBeenNthCalledWith(2, "diagnosis");

    fireEvent.pointerEnter(screen.getByRole("link", { name: "相性" }));
    expect(mocks.preloadMainApplication).toHaveBeenNthCalledWith(3, "compatibility");
  });
});
