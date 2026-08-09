export type HorizontalSwipeDirection = "left" | "right";

const SWIPE_THRESHOLD_PX = 56;
const HORIZONTAL_DOMINANCE_RATIO = 1.2;

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
