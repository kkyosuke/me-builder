export type FamilyPackStatus = "active" | "ended";
export type FamilySeatStatus = "invited" | "active" | "left" | "cancelled" | "removed" | "ended";

export type FamilyPack = Readonly<{
  id: string;
  payerAccountId: string;
  status: FamilyPackStatus;
  maxSeats: 4;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}>;

export type FamilySeat = Readonly<{
  id: string;
  packId: string;
  slotNumber: number;
  role: "payer" | "member";
  memberAccountId: string | null;
  invitationId: string | null;
  status: FamilySeatStatus;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  terminatedAt: string | null;
}>;

export type FamilyPackReadModel = Readonly<{ pack: FamilyPack; seats: readonly FamilySeat[] }>;
export type FamilySeatMutationResult =
  | Readonly<{ type: "updated"; seat: FamilySeat }>
  | Readonly<{ type: "not-found" }>
  | Readonly<{ type: "capacity-reached" }>
  | Readonly<{ type: "account-already-assigned" }>
  | Readonly<{ type: "invalid-state" }>;
