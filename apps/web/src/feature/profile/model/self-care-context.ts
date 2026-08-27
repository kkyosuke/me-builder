import type { SelfCareConfirmationKind } from "@me-builder/shared";

export type SelfCareContextKind = SelfCareConfirmationKind;

export type SelfCareContextItem = Readonly<{
  id: string;
  brainItemId: string;
  statement: string;
  kind: SelfCareContextKind;
  status: "active" | "revoked";
  confirmedAt: string;
  updatedAt: string;
}>;

export type SelfCareContextResult = Readonly<{
  items: readonly SelfCareContextItem[];
  canManage: boolean;
}>;
