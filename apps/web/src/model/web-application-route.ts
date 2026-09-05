import { compatibilityRelationshipId } from "@me-builder/lib/compatibility";
import { LIFF_ENDPOINT_PATHNAME } from "./liff-navigation";

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
  if (segment.length === 0 || segment.includes("/")) return false;
  try {
    return decodeURIComponent(segment).length > 0;
  } catch {
    return false;
  }
}

function hasCompatibilityRelationshipId(pathname: string, prefix: string): boolean {
  if (!pathname.startsWith(prefix)) return false;
  return compatibilityRelationshipId.isValid(pathname.slice(prefix.length));
}

function hasDiagnosisResultId(pathname: string): boolean {
  const encodedId = pathname.match(/^\/diagnosis\/([^/]+)\/answers$/u)?.[1];
  if (!encodedId) return false;
  try {
    return decodeURIComponent(encodedId).length > 0;
  } catch {
    return false;
  }
}

export function resolveWebApplicationRoute(pathname: string): WebApplicationRoute {
  const path = withoutTrailingSlash(pathname);
  if (path === "/account-recovery") return "account-recovery";
  if (path === "/mcp/authorize") return "mcp-authorization";
  if (path === "/admin" || path === "/admin/statistics") return "admin";
  if (
    path === "/compatibility" ||
    path === "/compatibility/share" ||
    hasCompatibilityRelationshipId(path, "/compatibility/invitations/") ||
    hasCompatibilityRelationshipId(path, "/compatibility/relationships/")
  ) {
    return "compatibility";
  }
  if (path === "/me" || path === "/me/self-care") return "me";
  if (
    path === "/profile" ||
    path === "/profile/avatar" ||
    path === "/profile/photos" ||
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
    path === LIFF_ENDPOINT_PATHNAME ||
    path === "/diagnosis" ||
    hasSingleSegment(path, "/diagnosis/") ||
    hasDiagnosisResultId(path)
  ) {
    return "diagnosis";
  }
  return "not-found";
}
