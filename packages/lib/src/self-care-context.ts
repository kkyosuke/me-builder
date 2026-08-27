import type { SelfCareConfirmationKind } from "@me-builder/shared";

export { selfCareConfirmationKinds, type SelfCareConfirmationKind } from "@me-builder/shared";

export type SelfCareConfirmation = Readonly<{
  id: string;
  brainItemId: string;
  statement: string;
  kind: SelfCareConfirmationKind;
  status: "active" | "revoked";
  confirmedAt: string;
  updatedAt: string;
}>;

export type SelfCareContextReadModel = Readonly<{
  items: readonly SelfCareConfirmation[];
}>;

export type SelfCareConfirmationResult =
  | Readonly<{ type: "confirmed"; item: SelfCareConfirmation }>
  | Readonly<{ type: "brain-item-not-found" }>
  | Readonly<{ type: "not-confirmed" }>;

export type RevokeSelfCareConfirmationResult =
  | Readonly<{ type: "revoked"; item: SelfCareConfirmation }>
  | Readonly<{ type: "not-found" }>;
