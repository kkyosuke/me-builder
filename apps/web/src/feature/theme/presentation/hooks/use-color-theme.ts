import { useCallback, useEffect, useState } from "react";
import {
  applyColorTheme,
  readColorTheme,
  saveColorTheme,
} from "../../infrastructure/color-theme-storage";
import type { ColorTheme } from "../../model/color-theme";

export function useColorTheme(): { theme: ColorTheme; toggleTheme: () => void } {
  const [theme, setTheme] = useState(readColorTheme);

  useEffect(() => {
    applyColorTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      saveColorTheme(next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
