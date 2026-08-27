import type { MouseEvent } from "react";

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.currentTarget.target !== "_blank" &&
    !event.currentTarget.hasAttribute("download")
  );
}

/** 通常クリックだけをアプリ内遷移にし、修飾キー付きクリックはブラウザへ委ねる。 */
export function navigateWithinApp(
  event: MouseEvent<HTMLAnchorElement>,
  href: string,
  options: { skip?: boolean; state?: unknown } = {},
): void {
  if (!isPlainPrimaryClick(event)) return;
  event.preventDefault();
  if (options.skip) return;

  window.history.pushState(options.state ?? {}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
}
