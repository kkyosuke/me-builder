export type CompatibilityRoute = "invitation" | "list" | "result" | "share";

export function resolveCompatibilityRoute(pathname: string): CompatibilityRoute {
  if (pathname.startsWith("/compatibility/invitations/")) return "invitation";
  if (pathname === "/compatibility/share") return "share";
  if (pathname.startsWith("/compatibility/demo")) return "result";
  return "list";
}
