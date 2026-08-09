import { useCallback, useEffect, useState } from "react";
import {
  applyColorTheme,
  readColorTheme,
  saveColorTheme,
} from "../../infrastructure/color-theme-storage";
import type { ColorTheme } from "../../model/color-theme";

export function useColorTheme(): {
  theme: ColorTheme;
  setTheme: (theme: ColorTheme) => void;
  toggleTheme: () => void;
} {
  const [theme, setTheme] = useState(readColorTheme);

  useEffect(() => {
    applyColorTheme(theme);
  }, [theme]);

  const selectTheme = useCallback((next: ColorTheme) => {
    saveColorTheme(next);
    setTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    selectTheme(theme === "dark" ? "light" : "dark");
  }, [selectTheme, theme]);

  return { theme, setTheme: selectTheme, toggleTheme };
}
