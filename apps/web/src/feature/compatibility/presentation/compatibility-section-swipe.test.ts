import { describe, expect, it } from "vitest";
import {
  resolveCompatibilitySectionDrag,
  resolveCompatibilitySectionSwipe,
} from "./compatibility-section-swipe";

describe("resolveCompatibilitySectionDrag", () => {
  it("表示中のパネルから隣のパネルまで指に追従する", () => {
    expect(resolveCompatibilitySectionDrag({ activeIndex: 0, dx: -80, viewportWidth: 320 })).toBe(
      -80,
    );
    expect(resolveCompatibilitySectionDrag({ activeIndex: 1, dx: 80, viewportWidth: 320 })).toBe(
      80,
    );
  });

  it("両端の外側と隣のパネルを越える移動はクランプする", () => {
    expect(resolveCompatibilitySectionDrag({ activeIndex: 0, dx: 80, viewportWidth: 320 })).toBe(0);
    expect(resolveCompatibilitySectionDrag({ activeIndex: 0, dx: -400, viewportWidth: 320 })).toBe(
      -320,
    );
    expect(resolveCompatibilitySectionDrag({ activeIndex: 1, dx: -80, viewportWidth: 320 })).toBe(
      0,
    );
  });
});

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
