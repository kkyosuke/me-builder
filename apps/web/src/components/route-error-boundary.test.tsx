// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteErrorBoundary, recoverFromChunkLoadFailure } from "./route-error-boundary";

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
}));

vi.mock("@me-builder/shared", () => ({
  logger: { error: mocks.loggerError },
}));

function FailedRoute(): never {
  throw new Error("render failed");
}

describe("RouteErrorBoundary", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("古いlazy chunkの読み込み失敗時だけ、リリース単位で1回再取得する", () => {
    const replace = vi.fn();
    const dependencies = {
      appVersion: "abc123",
      currentUrl: "https://example.com/compatibility/share?from=line",
      replace,
      storage: window.sessionStorage,
    };

    expect(
      recoverFromChunkLoadFailure(
        new TypeError("Failed to fetch dynamically imported module: /assets/old.js"),
        dependencies,
      ),
    ).toBe(true);
    expect(replace).toHaveBeenCalledWith(
      "https://example.com/compatibility/share?from=line&app-reload=abc123",
    );
    expect(recoverFromChunkLoadFailure(new Error("chunk load failed"), dependencies)).toBe(false);
    expect(replace).toHaveBeenCalledOnce();
  });

  it("通常の描画エラーでは自動再読み込みしない", () => {
    const replace = vi.fn();

    expect(
      recoverFromChunkLoadFailure(new Error("render failed"), {
        appVersion: "abc123",
        currentUrl: "https://example.com/compatibility",
        replace,
        storage: window.sessionStorage,
      }),
    ).toBe(false);
    expect(replace).not.toHaveBeenCalled();
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
    expect(mocks.loggerError).toHaveBeenCalledWith(
      {
        event: "web.route-render.failed",
        outcome: "failed",
        reason: "render-error",
      },
      "画面の描画に失敗しました",
    );
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});
