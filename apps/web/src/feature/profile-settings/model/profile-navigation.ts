export type ProfileView =
  | "closed"
  | "profile"
  | "avatar"
  | "personal-data"
  | "brain-items"
  | "family"
  | "billing"
  | "mcp"
  | "photos";

export type MainRoute = "compatibility" | "diagnosis" | "me";

const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

export const PROFILE_HISTORY_STATE_KEY = "me-builder-profile-view";
export const PROFILE_RETURN_PATHNAME_STATE_KEY = "me-builder-profile-return-pathname";

export function isDevelopmentEnvironment(environment: string | undefined): boolean {
  return DEVELOPMENT_ENVIRONMENTS.has(environment ?? "");
}

export function resolveProfileView(pathname: string, environment: string | undefined): ProfileView {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path === "/profile/photos" || /^\/profile\/photos\/[^/]+$/u.test(path)) return "photos";
  if (path === "/profile/mcp") return "mcp";
  if (path === "/profile/billing") return "billing";
  if (path === "/profile/family") return "family";
  if (path === "/profile/avatar") return "avatar";
  if (path === "/profile/personal-data") {
    return isDevelopmentEnvironment(environment) ? "personal-data" : "profile";
  }
  if (path === "/profile/brain-items") {
    return isDevelopmentEnvironment(environment) ? "brain-items" : "profile";
  }
  if (path === "/profile") return "profile";
  return "closed";
}

export function historyProfileView(state: unknown): Exclude<ProfileView, "closed"> | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[PROFILE_HISTORY_STATE_KEY];
  return value === "profile" ||
    value === "avatar" ||
    value === "personal-data" ||
    value === "brain-items" ||
    value === "family" ||
    value === "billing" ||
    value === "mcp" ||
    value === "photos"
    ? value
    : null;
}

export function historyProfileReturnPathname(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[PROFILE_RETURN_PATHNAME_STATE_KEY];
  return typeof value === "string" && value.startsWith("/") ? value : null;
}
