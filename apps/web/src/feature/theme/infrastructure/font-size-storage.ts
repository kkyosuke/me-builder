import { DEFAULT_FONT_SIZE, type FontSize, isFontSize } from "../model/font-size";

const STORAGE_KEY = "me-builder-font-size";
const FONT_SIZE_CLASSES = ["font-size-small", "font-size-medium", "font-size-large"];

export function readFontSize(): FontSize {
  if (typeof window === "undefined") {
    return DEFAULT_FONT_SIZE;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isFontSize(stored) ? stored : DEFAULT_FONT_SIZE;
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

export function applyFontSize(fontSize: FontSize): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.remove(...FONT_SIZE_CLASSES);
  document.documentElement.classList.add(`font-size-${fontSize}`);
}

export function saveFontSize(fontSize: FontSize): void {
  applyFontSize(fontSize);
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, fontSize);
  } catch {
    // Storageを利用できない環境でも、そのページ内の文字サイズ切替は維持します。
  }
}

export function initializeFontSize(): FontSize {
  const fontSize = readFontSize();
  applyFontSize(fontSize);
  return fontSize;
}
