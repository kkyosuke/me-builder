export const selfCareConfirmationKinds = [
  "stress-trigger",
  "early-sign",
  "worked",
  "did-not-work",
  "recent-state",
] as const;

export type SelfCareConfirmationKind = (typeof selfCareConfirmationKinds)[number];
