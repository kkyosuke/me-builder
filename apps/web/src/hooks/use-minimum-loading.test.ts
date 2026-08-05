// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMinimumLoading } from "./use-minimum-loading";

describe("useMinimumLoading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loading終了後も最小表示時間までは表示を維持する", () => {
    const { result, rerender } = renderHook(({ isLoading }) => useMinimumLoading(isLoading, 300), {
      initialProps: { isLoading: true },
    });

    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(100);
      rerender({ isLoading: false });
    });
    expect(result.current).toBe(true);

    act(() => vi.advanceTimersByTime(199));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it("最小表示時間を過ぎたloadingには終了後の待ち時間を加えない", () => {
    const { result, rerender } = renderHook(({ isLoading }) => useMinimumLoading(isLoading, 300), {
      initialProps: { isLoading: true },
    });

    act(() => vi.advanceTimersByTime(400));
    act(() => rerender({ isLoading: false }));
    act(() => vi.runOnlyPendingTimers());

    expect(result.current).toBe(false);
  });
});
