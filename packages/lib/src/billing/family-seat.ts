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

export type FamilySeatInvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired";

export type FamilySeatInvitation = Readonly<{
  id: string;
  seatId: string;
  inviterAccountId: string;
  status: FamilySeatInvitationStatus;
  expiresAt: string;
  claimedByAccountId: string | null;
  consumedAt: string | null;
  createdAt: string;
}>;

export type FamilySeatInvitationMutationResult =
  | Readonly<{ type: "created"; invitation: FamilySeatInvitation; seat: FamilySeat }>
  | Readonly<{ type: "updated"; invitation: FamilySeatInvitation; seat: FamilySeat }>
  | Readonly<{ type: "not-found" }>
  | Readonly<{ type: "capacity-reached" }>
  | Readonly<{ type: "expired" }>
  | Readonly<{ type: "token-used" }>
  | Readonly<{ type: "account-already-assigned" }>
  | Readonly<{ type: "forbidden" }>;
