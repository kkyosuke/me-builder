export function parseAdminLineUserIds(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((userId) => userId.trim())
    .filter(Boolean);
}

export function resolveLineAccountRole(
  userId: string,
  adminLineUserIds: readonly string[],
): "user" | "admin" {
  return adminLineUserIds.includes(userId) ? "admin" : "user";
}
