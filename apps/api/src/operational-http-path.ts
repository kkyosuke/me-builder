const COMPATIBILITY_INVITATION_PREFIX = "/api/compatibility/invitations/";
const COMPATIBILITY_RELATIONSHIP_PREFIX = "/api/compatibility/relationships/";

/** capabilityを含む動的pathを、運用ログへ出せる登録route patternへ変換する。 */
export function operationalHttpPath(path: string): string {
  if (path.startsWith(COMPATIBILITY_INVITATION_PREFIX)) {
    return "/api/compatibility/invitations/:relationshipId";
  }
  if (path.startsWith(COMPATIBILITY_RELATIONSHIP_PREFIX)) {
    return "/api/compatibility/relationships/:relationshipId";
  }
  return path;
}
