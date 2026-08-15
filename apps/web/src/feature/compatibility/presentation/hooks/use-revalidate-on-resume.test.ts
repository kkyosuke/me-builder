// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRevalidateOnResume } from "./use-revalidate-on-resume";

describe("useRevalidateOnResume", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("復帰と再接続を短時間に1回へまとめ、常時ポーリングしない", () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const revalidate = vi.fn();
    renderHook(() => useRevalidateOnResume(revalidate));

    now += 29_999;
    act(() => window.dispatchEvent(new Event("focus")));
    expect(revalidate).not.toHaveBeenCalled();

    now += 1;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    expect(revalidate).toHaveBeenCalledOnce();

    now += 30_000;
    act(() => window.dispatchEvent(new Event("online")));
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it("非表示になった時と通常のpageshowでは再検証しない", () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const revalidate = vi.fn();
    renderHook(() => useRevalidateOnResume(revalidate));
    now += 30_000;

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });

    expect(revalidate).not.toHaveBeenCalled();
  });
});
