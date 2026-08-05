import { useEffect, useRef, useState } from "react";

export const DEFAULT_MINIMUM_LOADING_MS = 400;

/** loadingが表示された後、指定時間が経過するまでは表示を維持する。 */
export function useMinimumLoading(
  isLoading: boolean,
  minimumMs = DEFAULT_MINIMUM_LOADING_MS,
): boolean {
  const [keepVisible, setKeepVisible] = useState(isLoading);
  const shownAt = useRef<number | null>(isLoading ? Date.now() : null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }

    if (isLoading) {
      shownAt.current ??= Date.now();
      setKeepVisible(true);
      return;
    }

    if (shownAt.current === null) {
      setKeepVisible(false);
      return;
    }

    const remainingMs = Math.max(0, minimumMs - (Date.now() - shownAt.current));
    hideTimer.current = setTimeout(() => {
      shownAt.current = null;
      hideTimer.current = null;
      setKeepVisible(false);
    }, remainingMs);

    return () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };
  }, [isLoading, minimumMs]);

  return isLoading || keepVisible;
}
