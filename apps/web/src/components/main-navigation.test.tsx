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

  it("移動先へポインターまたはフォーカスを向けた時だけ先読みする", () => {
    render(<MainNavigation current="me" />);

    fireEvent.pointerEnter(screen.getByRole("link", { name: "わたし" }));
    expect(mocks.preloadMainApplication).not.toHaveBeenCalled();

    const diagnosisLink = screen.getByRole("link", { name: "診断" });
    fireEvent.pointerEnter(diagnosisLink);
    fireEvent.focus(diagnosisLink);
    expect(mocks.preloadMainApplication).toHaveBeenNthCalledWith(1, "diagnosis");
    expect(mocks.preloadMainApplication).toHaveBeenNthCalledWith(2, "diagnosis");
  });
});
