export type ServiceSiteRoute = "home";

/** 認証を始めずに表示する公開サイトのpathnameだけを判定する。 */
export function resolveServiceSiteRoute(pathname: string): ServiceSiteRoute | null {
  return pathname === "/" ? "home" : null;
}
