import { d1 } from "@me-builder/lib";

/** Brain Item domain operations owned by one AccountData Object. */
export const brainActions = {
  "brain.findProfileSummaryDiaryData": (db: d1.Client, accountId: string) =>
    d1.action.brain.findProfileSummaryDiaryData(db, accountId),
  "source.hasActive": (db: d1.Client, accountId: string) =>
    d1.action.source.hasActiveSourceRecords(db, accountId),
} as const;
