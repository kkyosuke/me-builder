const COMPATIBILITY_INVITATION_PATH = /^\/api\/compatibility\/invitations\/[^/]+$/;

/** capabilityを含む動的pathを、運用ログへ出せる登録route patternへ変換する。 */
export function operationalHttpPath(path: string): string {
  return COMPATIBILITY_INVITATION_PATH.test(path)
    ? "/api/compatibility/invitations/:relationshipId"
    : path;
}
