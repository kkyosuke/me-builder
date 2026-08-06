import { type ColorTheme, DEFAULT_COLOR_THEME, isColorTheme } from "../model/color-theme";

const STORAGE_KEY = "me-builder-color-theme";

export function readColorTheme(): ColorTheme {
  if (typeof window === "undefined") {
    return DEFAULT_COLOR_THEME;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isColorTheme(stored) ? stored : DEFAULT_COLOR_THEME;
  } catch {
    return DEFAULT_COLOR_THEME;
  }
}

export function applyColorTheme(theme: ColorTheme): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
  document.documentElement.style.colorScheme = theme;
}

export function saveColorTheme(theme: ColorTheme): void {
  applyColorTheme(theme);
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storageを利用できない環境でも、そのページ内のテーマ切替は維持します。
  }
}

export function initializeColorTheme(): ColorTheme {
  const theme = readColorTheme();
  applyColorTheme(theme);
  return theme;
}
