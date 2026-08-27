export type WebApplicationRoute =
  | "account-recovery"
  | "admin"
  | "compatibility"
  | "diagnosis"
  | "mcp-authorization"
  | "me"
  | "profile"
  | "not-found";

function withoutTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function hasSingleSegment(pathname: string, prefix: string): boolean {
  if (!pathname.startsWith(prefix)) return false;
  const segment = pathname.slice(prefix.length);
  return segment.length > 0 && !segment.includes("/");
}

export function resolveWebApplicationRoute(pathname: string): WebApplicationRoute {
  const path = withoutTrailingSlash(pathname);
  if (path === "/account-recovery") return "account-recovery";
  if (path === "/mcp/authorize") return "mcp-authorization";
  if (path === "/admin" || path === "/admin/statistics") return "admin";
  if (
    path === "/compatibility" ||
    path === "/compatibility/share" ||
    hasSingleSegment(path, "/compatibility/invitations/") ||
    hasSingleSegment(path, "/compatibility/relationships/")
  ) {
    return "compatibility";
  }
  if (path === "/me" || path === "/me/self-care") return "me";
  if (
    path === "/profile" ||
    path === "/profile/avatar" ||
    path === "/profile/photos" ||
    hasSingleSegment(path, "/profile/photos/") ||
    path === "/profile/personal-data" ||
    path === "/profile/brain-items" ||
    path === "/profile/family" ||
    path === "/profile/billing" ||
    path === "/profile/mcp"
  ) {
    return "profile";
  }
  if (
    path === "/" ||
    path === "/app" ||
    path === "/diagnosis" ||
    hasSingleSegment(path, "/diagnosis/") ||
    /^\/diagnosis\/[^/]+\/answers$/u.test(path)
  ) {
    return "diagnosis";
  }
  return "not-found";
}
