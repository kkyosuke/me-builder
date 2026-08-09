export type HorizontalSwipeDirection = "left" | "right";

const SWIPE_THRESHOLD_PX = 56;
const HORIZONTAL_DOMINANCE_RATIO = 1.2;

/** 端の外側へ空白を見せず、指の移動量を隣のタブまでの範囲へ収める。 */
export function resolveCompatibilitySectionDrag({
  activeIndex,
  dx,
  viewportWidth,
}: {
  activeIndex: 0 | 1;
  dx: number;
  viewportWidth: number;
}): number {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1;
  if (activeIndex === 0) return Math.max(-width, Math.min(0, dx));
  return Math.min(width, Math.max(0, dx));
}

/** 縦スクロールや小さな指ぶれを除外し、タブ切り替えとして確定できる横方向を返す。 */
export function resolveCompatibilitySectionSwipe({
  cancelled = false,
  dx,
  dy,
}: {
  cancelled?: boolean;
  dx: number;
  dy: number;
}): HorizontalSwipeDirection | null {
  const horizontalDistance = Math.abs(dx);
  if (
    cancelled ||
    horizontalDistance < SWIPE_THRESHOLD_PX ||
    horizontalDistance <= Math.abs(dy) * HORIZONTAL_DOMINANCE_RATIO
  ) {
    return null;
  }
  return dx < 0 ? "left" : "right";
}
