import type { SwipeDirection } from "./model";

/**
 * スワイプの見た目と判定を決める純粋関数。
 *
 * ジェスチャー・アニメーションのライブラリは導入せず、Pointer Events で取った移動量から
 * CSS transform を組み立てます。判定と計算をこのモジュールへ寄せることで、DOM を用意せず
 * 単体テストできる状態に保ちます。
 */

/** カードの傾きの上限（度）。 */
export const MAX_CARD_ROTATION_DEG = 14;

/** 飛ばす／元位置へ戻すアニメーションの長さ（ms）。`prefers-reduced-motion` では使いません。 */
export const SWIPE_TRANSITION_MS = 260;

/** 表示するカードの重なりの枚数（最前面を含む）。 */
export const VISIBLE_STACK_SIZE = 3;

/** タップとドラッグを区別する移動量。小さな指ぶれはタップとして扱います。 */
const TAP_SLOP_PX = 8;

/** 幅を測る前（初回描画や測定失敗）に使う想定カード幅。 */
const FALLBACK_CARD_WIDTH = 320;

/** しきい値はカード幅に比例させ、極端に小さい／大きい画面で頭打ちにします。 */
const THRESHOLD_RATIO = 0.28;
const MIN_THRESHOLD = 56;
const MAX_THRESHOLD = 140;

/** 縦方向は指に完全には追従させず、横スワイプであることが分かる程度に留めます。 */
const VERTICAL_FOLLOW_RATIO = 0.4;
const MAX_VERTICAL_OFFSET = 72;

/** ドラッグ中の移動量（px）。 */
export interface DragOffset {
  dx: number;
  dy: number;
}

/** 押下位置からの移動量が、選択ボタンのタップとして扱える範囲か判定します。 */
export function isTapGesture(offset: DragOffset): boolean {
  return Math.hypot(offset.dx, offset.dy) <= TAP_SLOP_PX;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const normalizeCardWidth = (cardWidth: number): number =>
  Number.isFinite(cardWidth) && cardWidth > 0 ? cardWidth : FALLBACK_CARD_WIDTH;

/** カード幅から、回答が確定する横移動量のしきい値を求めます。 */
export function resolveSwipeThreshold(cardWidth: number): number {
  return clamp(normalizeCardWidth(cardWidth) * THRESHOLD_RATIO, MIN_THRESHOLD, MAX_THRESHOLD);
}

/** 横移動量に応じたカードの傾き（度）。 */
export function resolveCardRotationDeg(dx: number, cardWidth: number): number {
  const ratio = dx / normalizeCardWidth(cardWidth);
  return clamp(ratio * MAX_CARD_ROTATION_DEG * 2, -MAX_CARD_ROTATION_DEG, MAX_CARD_ROTATION_DEG);
}

/**
 * 選択しようとしている度合い（0〜1）。
 *
 * オーバーレイの濃さに使います。1 に達した時点が「離せば確定する」状態です。
 */
export function resolveChoiceProgress(dx: number, threshold: number): number {
  if (threshold <= 0) {
    return 0;
  }
  return clamp(Math.abs(dx) / threshold, 0, 1);
}

/**
 * 離した時点の移動量から確定する方向を求めます。しきい値未満なら `null`（元位置へ戻す）。
 */
export function resolveSwipeDirection(dx: number, threshold: number): SwipeDirection | null {
  if (Math.abs(dx) < threshold) {
    return null;
  }
  return dx > 0 ? "right" : "left";
}

/** ポインターを離したときの回答方向。キャンセル時は移動量にかかわらず確定しません。 */
export function resolveSwipeRelease(
  dx: number,
  threshold: number,
  cancelled = false,
): SwipeDirection | null {
  return cancelled ? null : resolveSwipeDirection(dx, threshold);
}

/** ドラッグ中のカードの transform。 */
export function buildDragTransform(offset: DragOffset, cardWidth: number): string {
  const y = clamp(offset.dy * VERTICAL_FOLLOW_RATIO, -MAX_VERTICAL_OFFSET, MAX_VERTICAL_OFFSET);
  const rotation = resolveCardRotationDeg(offset.dx, cardWidth);
  return `translate3d(${Math.round(offset.dx)}px, ${Math.round(y)}px, 0) rotate(${rotation.toFixed(2)}deg)`;
}

/** 確定後にカードを画面外へ飛ばす transform。 */
export function buildFlyOutTransform(direction: SwipeDirection, cardWidth: number): string {
  const distance = normalizeCardWidth(cardWidth) * 1.5 + 160;
  const x = direction === "right" ? distance : -distance;
  const rotation = direction === "right" ? MAX_CARD_ROTATION_DEG : -MAX_CARD_ROTATION_DEG;
  return `translate3d(${Math.round(x)}px, 24px, 0) rotate(${rotation}deg)`;
}

/** 重なりの奥行きに応じた見え方。`depth` 0 が最前面。 */
export function resolveStackLayer(depth: number): {
  transform: string;
  opacity: number;
  zIndex: number;
} {
  // 奥のカードは不透明のままにします。半透明にすると、手前のカードの背景を通して
  // さらに奥のカードの文字が透けて読めてしまいます。重なりは位置と大きさの差で示します。
  return {
    transform: `translate3d(0, ${depth * 14}px, 0) scale(${(1 - depth * 0.04).toFixed(2)})`,
    opacity: depth < VISIBLE_STACK_SIZE ? 1 : 0,
    zIndex: VISIBLE_STACK_SIZE - depth,
  };
}

/**
 * キーボード操作の対応。
 *
 * スワイプ以外の操作手段を必ず用意します。LINE 内は LIFF ですが外部ブラウザの導線も
 * 維持しているため（[プロジェクト概要 §4](../../../../docs/product/project-overview.md#4-想定する利用体験)）、
 * ポインタが無い環境でも同じ操作ができる必要があります。
 */
export function resolveKeyAction(key: string): SwipeDirection | "skip" | null {
  switch (key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowDown":
      return "skip";
    default:
      return null;
  }
}
