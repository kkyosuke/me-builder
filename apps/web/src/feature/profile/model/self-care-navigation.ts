export const SELF_CARE_RETURN_PATHNAME_STATE_KEY = "me-builder-self-care-return-pathname";

export function historySelfCareReturnPathname(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[SELF_CARE_RETURN_PATHNAME_STATE_KEY];
  return value === "/me" ? value : null;
}
