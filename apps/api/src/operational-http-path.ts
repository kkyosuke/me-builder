const COMPATIBILITY_INVITATION_PREFIX = "/api/compatibility/invitations/";

/** capabilityを含む動的pathを、運用ログへ出せる登録route patternへ変換する。 */
export function operationalHttpPath(path: string): string {
  return path.startsWith(COMPATIBILITY_INVITATION_PREFIX)
    ? "/api/compatibility/invitations/:relationshipId"
    : path;
}
