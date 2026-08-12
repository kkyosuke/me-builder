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

export function resolveCompatibilityInvitationId(pathname: string): string | null {
  const prefix = "/compatibility/invitations/";
  if (!pathname.startsWith(prefix)) return null;
  return compatibilityRelationshipId.parse(pathname.slice(prefix.length)) ?? null;
}

export function resolveCompatibilityRelationshipId(pathname: string): string | null {
  return pathname.match(/^\/compatibility\/relationships\/([a-f0-9]{64})$/)?.[1] ?? null;
}
