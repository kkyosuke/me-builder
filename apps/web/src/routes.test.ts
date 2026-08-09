// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getIdleMainApplicationRoutes,
  scheduleIdlePreload,
  scheduleIdlePreloadAfter,
} from "./routes";

describe("getIdleMainApplicationRoutes", () => {
  it.each([
    ["me", ["diagnosis"]],
    ["diagnosis", ["me", "compatibility"]],
    ["compatibility", ["diagnosis"]],
  ] as const)("%sでは隣接するタブだけを自動先読みする", (current, expected) => {
    expect(getIdleMainApplicationRoutes(current)).toEqual(expected);
  });
});

describe("scheduleIdlePreload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: undefined,
    });
  });

  it("ページの読み込み完了後、ブラウザーがアイドルになってから先読みする", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    let idleCallback: IdleRequestCallback | undefined;
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      idleCallback = callback;
      return 42;
    });
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    const preload = vi.fn();

    const cancel = scheduleIdlePreload(preload);

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2_000 });
    expect(preload).not.toHaveBeenCalled();
    idleCallback?.({ didTimeout: false, timeRemaining: () => 10 });
    expect(preload).toHaveBeenCalledOnce();

    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(42);
  });

  it("loadイベント前にはアイドル処理を予約しない", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const requestIdleCallback = vi.fn(() => 1);
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", vi.fn());

    scheduleIdlePreload(vi.fn());
    expect(requestIdleCallback).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("load"));
    expect(requestIdleCallback).toHaveBeenCalledOnce();
  });

  it("データセーバー利用中は自動先読みしない", () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true, effectiveType: "4g" },
    });
    const requestIdleCallback = vi.fn(() => 1);
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);

    scheduleIdlePreload(vi.fn());

    expect(requestIdleCallback).not.toHaveBeenCalled();
  });
});

describe("scheduleIdlePreloadAfter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("現在のチャンクが読み込み済みになるまでアイドル先読みを予約しない", async () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    const requestIdleCallback = vi.fn(() => 1);
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    let finishCurrentLoad: (() => void) | undefined;
    const currentLoad = new Promise<void>((resolve) => {
      finishCurrentLoad = resolve;
    });

    scheduleIdlePreloadAfter(() => currentLoad, vi.fn());
    expect(requestIdleCallback).not.toHaveBeenCalled();

    finishCurrentLoad?.();
    await currentLoad;
    expect(requestIdleCallback).toHaveBeenCalledOnce();
  });

  it("現在のチャンク取得中に破棄された場合は先読みしない", async () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    const requestIdleCallback = vi.fn(() => 1);
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    let finishCurrentLoad: (() => void) | undefined;
    const currentLoad = new Promise<void>((resolve) => {
      finishCurrentLoad = resolve;
    });

    const cancel = scheduleIdlePreloadAfter(() => currentLoad, vi.fn());
    cancel();
    finishCurrentLoad?.();
    await currentLoad;

    expect(requestIdleCallback).not.toHaveBeenCalled();
  });
});
