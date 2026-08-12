import { compatibilityRelationshipId } from "@me-builder/lib/compatibility";

export type CompatibilityRoute = "invitation" | "list" | "result" | "share";

export function resolveCompatibilityPathname(pathname: string, search: string): string {
  if (pathname.startsWith("/compatibility")) return pathname;

  const liffState = new URLSearchParams(search).get("liff.state");
  if (!liffState?.startsWith("/compatibility")) return pathname;
  return liffState.split(/[?#]/, 1)[0] ?? pathname;
}

export function resolveCompatibilityRoute(pathname: string): CompatibilityRoute {
  if (pathname.startsWith("/compatibility/invitations/")) return "invitation";
  if (pathname === "/compatibility/share") return "share";
  if (pathname.startsWith("/compatibility/relationships/")) return "result";
  return "list";
}

function resolveRelationshipId(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const relationshipId = pathname.slice(prefix.length);
  return compatibilityRelationshipId.isValid(relationshipId) ? relationshipId : null;
}

export function resolveCompatibilityInvitationId(pathname: string): string | null {
  return resolveRelationshipId(pathname, "/compatibility/invitations/");
}

export function resolveCompatibilityRelationshipId(pathname: string): string | null {
  return resolveRelationshipId(pathname, "/compatibility/relationships/");
}
