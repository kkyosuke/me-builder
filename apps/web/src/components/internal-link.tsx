import type { ComponentPropsWithoutRef } from "react";
import { navigateWithinApp } from "../model/internal-navigation";
import { type MainApplicationRoute, preloadMainApplication } from "../routes";

type InternalLinkProps = ComponentPropsWithoutRef<"a"> & {
  historyState?: unknown;
  href: string;
  onPreload?: () => void;
  preloadRoute?: MainApplicationRoute;
};

/** 同一アプリ内の通常クリックでは画面状態を保ち、別タブで開く操作はブラウザへ委ねる。 */
export function InternalLink({
  href,
  historyState,
  onClick,
  onFocus,
  onPointerEnter,
  onPreload,
  preloadRoute,
  ...props
}: InternalLinkProps) {
  const preload = () => {
    onPreload?.();
    if (preloadRoute) preloadMainApplication(preloadRoute);
  };

  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) navigateWithinApp(event, href, { state: historyState });
      }}
      onFocus={(event) => {
        onFocus?.(event);
        preload();
      }}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        preload();
      }}
    />
  );
}
