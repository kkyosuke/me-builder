export const selfCareConfirmationKinds = ["worked", "did-not-work", "recent-state"] as const;
export type SelfCareConfirmationKind = (typeof selfCareConfirmationKinds)[number];

export type SelfCareConfirmation = Readonly<{
  id: string;
  brainItemId: string;
  statement: string;
  kind: SelfCareConfirmationKind;
  status: "active" | "revoked";
  confirmedAt: string;
  updatedAt: string;
}>;

export type SelfCareConfirmationResult =
  | Readonly<{ type: "confirmed"; item: SelfCareConfirmation }>
  | Readonly<{ type: "brain-item-not-found" }>
  | Readonly<{ type: "not-confirmed" }>;

export type RevokeSelfCareConfirmationResult =
  | Readonly<{ type: "revoked"; item: SelfCareConfirmation }>
  | Readonly<{ type: "not-found" }>;
