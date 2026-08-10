import { accountData } from "@me-builder/lib";

/** Brain Item domain operations owned by one AccountData Object. */
export const brainActions = {
  "brain.listActive": (db: accountData.Database, accountId: string) =>
    accountData.action.brain.listActiveBrainItems(db, accountId),
  "source.hasActive": (db: accountData.Database, accountId: string) =>
    accountData.action.source.hasActiveSourceRecords(db, accountId),
} as const;
