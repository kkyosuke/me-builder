export type ServiceSiteRoute = "commercial-transactions" | "contact" | "home" | "privacy" | "terms";

/** 認証を始めずに表示する公開サイトのpathnameだけを判定する。 */
export function resolveServiceSiteRoute(pathname: string): ServiceSiteRoute | null {
  if (pathname === "/") return "home";
  if (pathname === "/terms") return "terms";
  if (pathname === "/privacy") return "privacy";
  if (pathname === "/contact") return "contact";
  if (pathname === "/commercial-transactions") return "commercial-transactions";
  return null;
}
