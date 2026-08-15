export type ServiceSiteRoute = "home" | "terms";

/** 認証を始めずに表示する公開サイトのpathnameだけを判定する。 */
export function resolveServiceSiteRoute(pathname: string): ServiceSiteRoute | null {
  if (pathname === "/") return "home";
  if (pathname === "/terms") return "terms";
  return null;
}
