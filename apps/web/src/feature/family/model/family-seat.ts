export type FamilySeat = Readonly<{
  id: string;
  slotNumber: number;
  role: "payer" | "member";
  status: "invited" | "active" | "left" | "cancelled" | "removed" | "ended";
  displayName: string | null;
}>;

export type FamilySeatManagement = Readonly<{
  role: "payer" | "member";
  maxSeats: 4;
  seats: readonly FamilySeat[];
}>;

export type FamilyInvitation = Readonly<{
  token: string;
  expiresAt: string;
  seat: FamilySeat;
}>;
