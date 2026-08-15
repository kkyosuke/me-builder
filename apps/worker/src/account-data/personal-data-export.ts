import { DO } from "@me-builder/lib";

/** 本人データexportの要求、状態確認、期限付きarchive読込。 */
export const personalDataExportActions = {
  "personalDataExport.request": (db: DO.account.Database, accountId: string, at?: Date) =>
    DO.account.action.personalDataExport.requestPersonalDataExport(db, accountId, at),
  "personalDataExport.readStatus": (
    db: DO.account.Database,
    accountId: string,
    exportId: string,
    at?: Date,
  ) =>
    DO.account.action.personalDataExport.readPersonalDataExportStatus(db, accountId, exportId, at),
  "personalDataExport.readArchive": (
    db: DO.account.Database,
    accountId: string,
    exportId: string,
    at?: Date,
  ) => DO.account.action.personalDataExport.readPersonalDataArchive(db, accountId, exportId, at),
} as const;
