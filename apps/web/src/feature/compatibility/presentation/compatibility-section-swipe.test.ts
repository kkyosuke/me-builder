import { describe, expect, it } from "vitest";
import { resolveCompatibilitySectionSwipe } from "./compatibility-section-swipe";

describe("resolveCompatibilitySectionSwipe", () => {
  it.each([
    [{ dx: -80, dy: 12 }, "left"],
    [{ dx: 80, dy: -12 }, "right"],
  ] as const)("明確な横スワイプを確定する", (offset, expected) => {
    expect(resolveCompatibilitySectionSwipe(offset)).toBe(expected);
  });

  it.each([
    { dx: 40, dy: 0 },
    { dx: 80, dy: 72 },
    { dx: 100, dy: 0, cancelled: true },
  ])("短い移動・縦移動・キャンセルはタブ切り替えにしない", (offset) => {
    expect(resolveCompatibilitySectionSwipe(offset)).toBeNull();
  });
});
