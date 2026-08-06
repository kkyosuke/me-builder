import { Moon, Sun } from "lucide-react";
import type { ColorTheme } from "../../model/color-theme";

export function ColorThemeToggle({
  theme,
  onToggle,
}: {
  theme: ColorTheme;
  onToggle: () => void;
}) {
  const isDark = theme === "dark";
  const label = isDark ? "ライトモードに切り替える" : "ダークモードに切り替える";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onToggle}
      className="fixed top-4 right-4 z-50 inline-flex size-11 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-700 shadow-lg shadow-slate-950/10 backdrop-blur transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-200 dark:shadow-slate-950/30 dark:hover:bg-slate-700"
    >
      {isDark ? (
        <Sun className="size-5" aria-hidden="true" />
      ) : (
        <Moon className="size-5" aria-hidden="true" />
      )}
    </button>
  );
}
