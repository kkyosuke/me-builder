// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeFontSize, readFontSize, saveFontSize } from "./font-size-storage";

describe("font size storage", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove(
      "font-size-small",
      "font-size-medium",
      "font-size-large",
    );
  });

  it("保存値がない場合は中を適用する", () => {
    expect(initializeFontSize()).toBe("medium");
    expect(document.documentElement.classList.contains("font-size-medium")).toBe(true);
  });

  it("選んだ文字サイズを保存し、次回の初期化で復元する", () => {
    saveFontSize("small");
    document.documentElement.classList.remove("font-size-small");

    expect(readFontSize()).toBe("small");
    expect(initializeFontSize()).toBe("small");
    expect(document.documentElement.classList.contains("font-size-small")).toBe(true);
  });

  it("不正な保存値は中へ戻す", () => {
    window.localStorage.setItem("me-builder-font-size", "extra-large");

    expect(readFontSize()).toBe("medium");
  });
});
