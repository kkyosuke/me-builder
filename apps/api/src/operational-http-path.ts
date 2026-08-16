const COMPATIBILITY_INVITATION_PREFIX = "/api/compatibility/invitations/";
const COMPATIBILITY_RELATIONSHIP_PREFIX = "/api/compatibility/relationships/";
const PERSONAL_DATA_RECORD_PREFIX = "/api/personal-data/records/";
const PERSONAL_DATA_EXPORT_PREFIX = "/api/personal-data/exports/";
const FAMILY_INVITATION_PREFIX = "/api/family/invitations/";
const FAMILY_SEAT_PREFIX = "/api/family/seats/";

/** capabilityを含む動的pathを、運用ログへ出せる登録route patternへ変換する。 */
export function operationalHttpPath(path: string): string {
  if (path.startsWith(FAMILY_INVITATION_PREFIX)) return "/api/family/invitations/:seatId";
  if (path.startsWith(FAMILY_SEAT_PREFIX)) return "/api/family/seats/:seatId";
  if (path.startsWith(PERSONAL_DATA_EXPORT_PREFIX)) {
    return path.endsWith("/download")
      ? "/api/personal-data/exports/:exportId/download"
      : "/api/personal-data/exports/:exportId";
  }
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
