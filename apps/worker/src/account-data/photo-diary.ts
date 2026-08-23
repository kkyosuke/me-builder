import { DO, type ReservePhotoDiaryInput } from "@me-builder/lib";

export const photoDiaryActions = {
  "photoDiary.reserve": (
    db: DO.account.Database,
    accountId: string,
    input: ReservePhotoDiaryInput,
    at?: Date,
  ) => DO.account.action.photoDiary.reservePhotoDiaryMedia(db, accountId, input, at),
  "photoDiary.complete": (db: DO.account.Database, accountId: string, mediaId: string, at?: Date) =>
    DO.account.action.photoDiary.completePhotoDiaryMedia(db, accountId, mediaId, at),
  "photoDiary.releaseReservation": (db: DO.account.Database, accountId: string, mediaId: string) =>
    DO.account.action.photoDiary.releasePhotoDiaryReservation(db, accountId, mediaId),
  "photoDiary.list": (db: DO.account.Database, accountId: string, limit?: number) =>
    DO.account.action.photoDiary.listPhotoDiaryMedia(db, accountId, limit),
  "photoDiary.findByLineMessage": (
    db: DO.account.Database,
    accountId: string,
    lineMessageId: string,
  ) => DO.account.action.photoDiary.findPhotoDiaryMediaByLineMessage(db, accountId, lineMessageId),
  "photoDiary.readStorageUsage": (db: DO.account.Database, accountId: string) =>
    DO.account.action.photoDiary.readPhotoDiaryStorageUsage(db, accountId),
  "photoDiary.listObjectKeys": (db: DO.account.Database, accountId: string) =>
    DO.account.action.photoDiary.listPhotoDiaryObjectKeys(db, accountId),
  "photoDiary.get": (db: DO.account.Database, accountId: string, mediaId: string) =>
    DO.account.action.photoDiary.getPhotoDiaryMedia(db, accountId, mediaId),
  "photoDiary.markDeleting": (
    db: DO.account.Database,
    accountId: string,
    mediaId: string,
    at?: Date,
  ) => DO.account.action.photoDiary.markPhotoDiaryDeleting(db, accountId, mediaId, at),
  "photoDiary.listUndispatchedDeletionIds": (db: DO.account.Database, accountId: string) =>
    DO.account.action.photoDiary.listUndispatchedPhotoDiaryDeletionIds(db, accountId),
  "photoDiary.markDeletionEnqueued": (
    db: DO.account.Database,
    accountId: string,
    mediaId: string,
    at?: Date,
  ) => DO.account.action.photoDiary.markPhotoDiaryDeletionEnqueued(db, accountId, mediaId, at),
  "photoDiary.getDeleting": (db: DO.account.Database, accountId: string, mediaId: string) =>
    DO.account.action.photoDiary.getDeletingPhotoDiaryMedia(db, accountId, mediaId),
  "photoDiary.completeDeletion": (
    db: DO.account.Database,
    accountId: string,
    mediaId: string,
    at?: Date,
  ) => DO.account.action.photoDiary.completePhotoDiaryDeletion(db, accountId, mediaId, at),
} as const;
