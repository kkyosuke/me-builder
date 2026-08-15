/** 遅れて内容が伸びる画面でも、指定位置へ到達するまでスクロール復元を再試行する。 */
export function restoreWindowScroll(top: number): () => void {
  let animationFrameId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let timeoutId: number | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
    resizeObserver?.disconnect();
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  };
  const apply = () => {
    animationFrameId = null;
    window.scrollTo(0, top);
    if (Math.abs(window.scrollY - top) <= 1) stop();
  };
  const schedule = () => {
    if (stopped || animationFrameId !== null) return;
    animationFrameId = window.requestAnimationFrame(apply);
  };

  apply();
  if (!stopped && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(document.body);
  }
  if (!stopped) timeoutId = window.setTimeout(stop, 5_000);

  return stop;
}
