// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCompatibilityRoute } from "./use-compatibility-route";

describe("useCompatibilityRoute", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("相性内の画面ごとに位置を保存し、初めての画面では先頭を表示する", () => {
    window.history.replaceState({}, "", "/compatibility");
    let scrollY = 420;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((_x, top) => {
      scrollY = top ?? scrollY;
    });
    const { result } = renderHook(() => useCompatibilityRoute());

    act(() => {
      window.history.pushState({}, "", "/compatibility/share");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current).toEqual({ route: "share", pathname: "/compatibility/share" });
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    scrollY = 180;
    act(() => {
      window.history.pushState({}, "", `/compatibility/relationships/${"1".repeat(64)}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.route).toBe("result");
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    scrollY = 260;
    act(() => {
      window.history.pushState({}, "", "/compatibility/share");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.route).toBe("share");
    expect(scrollTo).toHaveBeenLastCalledWith(0, 180);

    scrollY = 90;
    act(() => {
      window.history.pushState({}, "", "/compatibility");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.route).toBe("list");
    expect(scrollTo).toHaveBeenLastCalledWith(0, 420);
  });
});
