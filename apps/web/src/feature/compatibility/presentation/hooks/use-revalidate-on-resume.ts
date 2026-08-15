import { useEffect } from "react";

const DEFAULT_DEDUPLICATION_WINDOW_MS = 1_000;

/** 復帰時にだけ再検証し、同時に発生するfocus/visibility/onlineを1回へまとめる。 */
export function useRevalidateOnResume(
  revalidate: () => void | Promise<void>,
  deduplicationWindowMs = DEFAULT_DEDUPLICATION_WINDOW_MS,
): void {
  useEffect(() => {
    let lastRevalidatedAt = Number.NEGATIVE_INFINITY;

    const requestRevalidation = () => {
      const now = Date.now();
      if (now - lastRevalidatedAt < deduplicationWindowMs) return;
      lastRevalidatedAt = now;
      void revalidate();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") requestRevalidation();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) requestRevalidation();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", requestRevalidation);
    window.addEventListener("online", requestRevalidation);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", requestRevalidation);
      window.removeEventListener("online", requestRevalidation);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [deduplicationWindowMs, revalidate]);
}
