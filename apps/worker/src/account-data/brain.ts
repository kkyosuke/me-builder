import { DO } from "@me-builder/lib";

/** Brain Item domain operations owned by one AccountData Object. */
export const brainActions = {
  "brain.listActive": (db: DO.account.Database, accountId: string) =>
    DO.account.action.brain.listActiveBrainItems(db, accountId),
  "source.hasActive": (db: DO.account.Database, accountId: string) =>
    DO.account.action.source.hasActiveSourceRecords(db, accountId),
} as const;
