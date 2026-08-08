import { d1 } from "@me-builder/lib";

/** Brain Item domain operations owned by one AccountData Object. */
export const brainActions = {
  "brain.save": d1.action.brain.saveBrainItem,
  "brain.find": d1.action.brain.findBrainItemForAccount,
  "source.hasActive": d1.action.source.hasActiveSourceRecords,
} as const;
