import { describe, expect, it } from "vitest";
import {
  MAX_CARD_ROTATION_DEG,
  VISIBLE_STACK_SIZE,
  buildDragTransform,
  buildFlyOutTransform,
  resolveCardRotationDeg,
  resolveChoiceProgress,
  resolveKeyAction,
  resolveStackLayer,
  resolveSwipeDirection,
  resolveSwipeThreshold,
} from "./swipe";

const CARD_WIDTH = 360;

describe("resolveSwipeThreshold", () => {
  it("カード幅に比例したしきい値を返すこと", () => {
    expect(resolveSwipeThreshold(400)).toBeCloseTo(112);
  });

  it("極端に狭い／広い幅では頭打ちになること", () => {
    expect(resolveSwipeThreshold(80)).toBe(56);
    expect(resolveSwipeThreshold(2000)).toBe(140);
  });

  it("幅を測る前（0 や NaN）でも既定の幅で計算できること", () => {
    // 初回描画では ResizeObserver の測定前なので 0 が渡る
    expect(resolveSwipeThreshold(0)).toBeCloseTo(89.6);
    expect(resolveSwipeThreshold(Number.NaN)).toBeCloseTo(89.6);
  });
});

describe("resolveSwipeDirection", () => {
  const threshold = resolveSwipeThreshold(CARD_WIDTH);

  it("しきい値未満なら null を返し、元位置へ戻せること", () => {
    expect(resolveSwipeDirection(threshold - 1, threshold)).toBeNull();
    expect(resolveSwipeDirection(-(threshold - 1), threshold)).toBeNull();
    expect(resolveSwipeDirection(0, threshold)).toBeNull();
  });

  it("しきい値以上なら移動した向きを返すこと", () => {
    expect(resolveSwipeDirection(threshold, threshold)).toBe("right");
    expect(resolveSwipeDirection(-threshold, threshold)).toBe("left");
    expect(resolveSwipeDirection(500, threshold)).toBe("right");
  });
});

describe("resolveChoiceProgress", () => {
  it("しきい値に達したところで 1 になること", () => {
    expect(resolveChoiceProgress(0, 100)).toBe(0);
    expect(resolveChoiceProgress(50, 100)).toBe(0.5);
    expect(resolveChoiceProgress(-50, 100)).toBe(0.5);
    expect(resolveChoiceProgress(100, 100)).toBe(1);
  });

  it("しきい値を超えても 1 を上限とすること", () => {
    expect(resolveChoiceProgress(400, 100)).toBe(1);
  });

  it("しきい値が 0 でもゼロ除算にならないこと", () => {
    expect(resolveChoiceProgress(10, 0)).toBe(0);
  });
});

describe("resolveCardRotationDeg", () => {
  it("移動量に応じて左右へ傾くこと", () => {
    expect(resolveCardRotationDeg(0, CARD_WIDTH)).toBe(0);
    expect(resolveCardRotationDeg(60, CARD_WIDTH)).toBeGreaterThan(0);
    expect(resolveCardRotationDeg(-60, CARD_WIDTH)).toBeLessThan(0);
  });

  it("傾きが上限を超えないこと", () => {
    expect(resolveCardRotationDeg(9999, CARD_WIDTH)).toBe(MAX_CARD_ROTATION_DEG);
    expect(resolveCardRotationDeg(-9999, CARD_WIDTH)).toBe(-MAX_CARD_ROTATION_DEG);
  });
});

describe("buildDragTransform", () => {
  it("横は指へ追従し、縦は抑えて追従すること", () => {
    const transform = buildDragTransform({ dx: 40, dy: 100 }, CARD_WIDTH);

    expect(transform).toContain("translate3d(40px, 40px, 0)");
    expect(transform).toContain("rotate(");
  });

  it("縦の追従に上限があること", () => {
    expect(buildDragTransform({ dx: 0, dy: 1000 }, CARD_WIDTH)).toContain(
      "translate3d(0px, 72px, 0)",
    );
  });
});

describe("buildFlyOutTransform", () => {
  it("スワイプした向きへ画面外まで飛ばすこと", () => {
    expect(buildFlyOutTransform("right", CARD_WIDTH)).toContain("translate3d(700px");
    expect(buildFlyOutTransform("left", CARD_WIDTH)).toContain("translate3d(-700px");
  });
});

describe("resolveStackLayer", () => {
  it("最前面が最も手前で不透明なこと", () => {
    const front = resolveStackLayer(0);

    expect(front.opacity).toBe(1);
    expect(front.zIndex).toBe(VISIBLE_STACK_SIZE);
  });

  it("奥のカードは小さく下へずれ、手前より奥に置かれること", () => {
    const behind = resolveStackLayer(1);

    expect(behind.zIndex).toBeLessThan(resolveStackLayer(0).zIndex);
    expect(behind.transform).toContain("scale(0.96)");
    expect(behind.transform).toContain("translate3d(0, 14px, 0)");
  });

  it("重なりの中のカードは不透明で、奥の文字が透けないこと", () => {
    expect(resolveStackLayer(1).opacity).toBe(1);
    expect(resolveStackLayer(VISIBLE_STACK_SIZE - 1).opacity).toBe(1);
  });

  it("表示枚数を超えたカードは見えないこと", () => {
    expect(resolveStackLayer(VISIBLE_STACK_SIZE).opacity).toBe(0);
  });
});

describe("resolveKeyAction", () => {
  it("矢印キーで回答とスキップができること", () => {
    expect(resolveKeyAction("ArrowLeft")).toBe("left");
    expect(resolveKeyAction("ArrowRight")).toBe("right");
    expect(resolveKeyAction("ArrowDown")).toBe("skip");
  });

  it("割り当てのないキーでは何もしないこと", () => {
    expect(resolveKeyAction("Enter")).toBeNull();
    expect(resolveKeyAction("a")).toBeNull();
  });
});
