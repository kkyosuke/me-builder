const FONT_SIZES = ["small", "medium", "large"] as const;

export type FontSize = (typeof FONT_SIZES)[number];

export const DEFAULT_FONT_SIZE: FontSize = "medium";

export function isFontSize(value: unknown): value is FontSize {
  return FONT_SIZES.includes(value as FontSize);
}
