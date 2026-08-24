import type { MainRoute } from "../model/profile-navigation";

export function focusMainRouteHeading(container: HTMLElement, route: MainRoute): () => void {
  let mutationObserver: MutationObserver | null = null;
  let timeoutId: number | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    mutationObserver?.disconnect();
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  };
  const focus = (): boolean => {
    const heading = container.querySelector<HTMLElement>(`[data-main-route-heading="${route}"]`);
    if (!heading) return false;
    heading.focus({ preventScroll: true });
    return true;
  };

  if (focus()) return stop;
  mutationObserver = new MutationObserver(() => {
    if (focus()) stop();
  });
  mutationObserver.observe(container, { childList: true, subtree: true });
  timeoutId = window.setTimeout(stop, 5_000);

  return stop;
}
