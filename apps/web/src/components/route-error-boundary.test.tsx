// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteErrorBoundary } from "./route-error-boundary";

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
}));

vi.mock("@me-builder/shared", () => ({
  logger: { error: mocks.loggerError },
}));

function FailedRoute(): never {
  throw new Error("chunk load failed");
}

describe("RouteErrorBoundary", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("画面の読み込み失敗を案内し、再読み込みできる", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onReload = vi.fn();

    render(
      <RouteErrorBoundary onReload={onReload}>
        <FailedRoute />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole("heading", { name: "画面を読み込めませんでした" })).toBeTruthy();
    expect(mocks.loggerError).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});
