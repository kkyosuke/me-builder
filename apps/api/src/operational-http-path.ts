const COMPATIBILITY_INVITATION_PREFIX = "/api/compatibility/invitations/";
const COMPATIBILITY_RELATIONSHIP_PREFIX = "/api/compatibility/relationships/";
const PERSONAL_DATA_RECORD_PREFIX = "/api/personal-data/records/";

/** capabilityを含む動的pathを、運用ログへ出せる登録route patternへ変換する。 */
export function operationalHttpPath(path: string): string {
  if (path.startsWith(COMPATIBILITY_INVITATION_PREFIX)) {
    return "/api/compatibility/invitations/:relationshipId";
  }
  if (path.startsWith(COMPATIBILITY_RELATIONSHIP_PREFIX)) {
    return "/api/compatibility/relationships/:relationshipId";
  }
  if (path.startsWith(PERSONAL_DATA_RECORD_PREFIX)) {
    return "/api/personal-data/records/:sourceRecordId";
  }
  return path;
}
