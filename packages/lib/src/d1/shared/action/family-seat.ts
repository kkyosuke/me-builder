import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type {
  FamilyPack,
  FamilyPackReadModel,
  FamilySeat,
  FamilySeatMutationResult,
  FamilySeatStatus,
} from "../../../billing/family-seat";
import type { SharedD1Client } from "../client";
import { accounts } from "../schema/account";
import { familyPacks, familySeats } from "../schema/family-seat";

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

const packModel = (row: typeof familyPacks.$inferSelect): FamilyPack => ({
  id: row.id,
  payerAccountId: row.payerAccountId,
  status: row.status,
  maxSeats: 4,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  endedAt: iso(row.endedAt),
});

const seatModel = (row: typeof familySeats.$inferSelect): FamilySeat => ({
  id: row.id,
  packId: row.packId,
  slotNumber: row.slotNumber,
  role: row.role,
  memberAccountId: row.memberAccountId,
  invitationId: row.invitationId,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  activatedAt: iso(row.activatedAt),
  terminatedAt: iso(row.terminatedAt),
});

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("UNIQUE constraint failed") ||
    message.includes("SQLITE_CONSTRAINT_UNIQUE") ||
    message.includes("SQLITE_CONSTRAINT_PRIMARYKEY")
  );
}

async function activeAccountExists(db: SharedD1Client, accountId: string): Promise<boolean> {
  return Boolean(
    await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.status, "active"),
          eq(accounts.isDeleted, false),
        ),
      )
      .get(),
  );
}

export async function readFamilyPackByPayer(
  db: SharedD1Client,
  payerAccountId: string,
): Promise<FamilyPackReadModel | null> {
  const pack = await db
    .select()
    .from(familyPacks)
    .where(
      and(
        eq(familyPacks.payerAccountId, payerAccountId),
        eq(familyPacks.status, "active"),
        eq(familyPacks.isDeleted, false),
      ),
    )
    .get();
  if (!pack) return null;
  const seats = await db
    .select()
    .from(familySeats)
    .where(and(eq(familySeats.packId, pack.id), eq(familySeats.isDeleted, false)))
    .orderBy(asc(familySeats.slotNumber), asc(familySeats.createdAt))
    .all();
  return { pack: packModel(pack), seats: seats.map(seatModel) };
}

export async function createFamilyPack(
  db: SharedD1Client,
  payerAccountId: string,
  at = new Date(),
): Promise<FamilyPackReadModel> {
  if (!(await activeAccountExists(db, payerAccountId))) throw new Error("Payer account not found");
  const existing = await readFamilyPackByPayer(db, payerAccountId);
  if (existing) return existing;

  const packId = crypto.randomUUID();
  const pack: typeof familyPacks.$inferInsert = {
    id: packId,
    payerAccountId,
    status: "active",
    maxSeats: 4,
    createdAt: at,
    updatedAt: at,
  };
  const payerSeat: typeof familySeats.$inferInsert = {
    id: crypto.randomUUID(),
    packId,
    slotNumber: 1,
    role: "payer",
    memberAccountId: payerAccountId,
    invitationId: null,
    status: "active",
    activatedAt: at,
    createdAt: at,
    updatedAt: at,
  };
  try {
    await db.batch([db.insert(familyPacks).values(pack), db.insert(familySeats).values(payerSeat)]);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await readFamilyPackByPayer(db, payerAccountId);
    if (raced) return raced;
    throw error;
  }
  return {
    pack: {
      id: packId,
      payerAccountId,
      status: "active",
      maxSeats: 4,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      endedAt: null,
    },
    seats: [
      {
        id: payerSeat.id,
        packId,
        slotNumber: 1,
        role: "payer",
        memberAccountId: payerAccountId,
        invitationId: null,
        status: "active",
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
        activatedAt: at.toISOString(),
        terminatedAt: null,
      },
    ],
  };
}

export async function reserveFamilySeat(
  db: SharedD1Client,
  payerAccountId: string,
  invitationId: string,
  at = new Date(),
): Promise<FamilySeatMutationResult> {
  const pack = await readFamilyPackByPayer(db, payerAccountId);
  if (!pack) return { type: "not-found" };
  if (!invitationId.trim()) return { type: "invalid-state" };
  const occupied = new Set(
    pack.seats
      .filter(({ status }) => status === "invited" || status === "active")
      .map(({ slotNumber }) => slotNumber),
  );
  for (let slotNumber = 1; slotNumber <= 4; slotNumber += 1) {
    if (occupied.has(slotNumber)) continue;
    const row: typeof familySeats.$inferInsert = {
      id: crypto.randomUUID(),
      packId: pack.pack.id,
      slotNumber,
      role: "member",
      memberAccountId: null,
      invitationId,
      status: "invited",
      createdAt: at,
      updatedAt: at,
    };
    try {
      await db.insert(familySeats).values(row);
      return {
        type: "updated",
        seat: {
          id: row.id,
          packId: pack.pack.id,
          slotNumber,
          role: "member",
          memberAccountId: null,
          invitationId,
          status: "invited",
          createdAt: at.toISOString(),
          updatedAt: at.toISOString(),
          activatedAt: null,
          terminatedAt: null,
        },
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existingInvitation = await db
        .select()
        .from(familySeats)
        .where(eq(familySeats.invitationId, invitationId))
        .get();
      if (existingInvitation) return { type: "updated", seat: seatModel(existingInvitation) };
    }
  }
  return { type: "capacity-reached" };
}

export async function activateFamilySeat(
  db: SharedD1Client,
  invitationId: string,
  memberAccountId: string,
  at = new Date(),
): Promise<FamilySeatMutationResult> {
  if (!(await activeAccountExists(db, memberAccountId))) return { type: "not-found" };
  try {
    const updated = await db
      .update(familySeats)
      .set({ memberAccountId, status: "active", activatedAt: at, updatedAt: at })
      .where(
        and(
          eq(familySeats.invitationId, invitationId),
          eq(familySeats.status, "invited"),
          eq(familySeats.isDeleted, false),
          sql`exists (select 1 from family_packs where family_packs.id = ${familySeats.packId} and family_packs.status = 'active' and family_packs.is_deleted = 0)`,
        ),
      )
      .returning()
      .get();
    return updated ? { type: "updated", seat: seatModel(updated) } : { type: "invalid-state" };
  } catch (error) {
    if (isUniqueViolation(error)) return { type: "account-already-assigned" };
    throw error;
  }
}

async function terminateSeat(
  db: SharedD1Client,
  input: Readonly<{
    seatId: string;
    expected: readonly FamilySeatStatus[];
    next: "left" | "cancelled" | "removed";
    at: Date;
  }>,
): Promise<FamilySeatMutationResult> {
  const updated = await db
    .update(familySeats)
    .set({ status: input.next, terminatedAt: input.at, updatedAt: input.at })
    .where(
      and(
        eq(familySeats.id, input.seatId),
        inArray(familySeats.status, input.expected),
        eq(familySeats.role, "member"),
        eq(familySeats.isDeleted, false),
      ),
    )
    .returning()
    .get();
  return updated ? { type: "updated", seat: seatModel(updated) } : { type: "invalid-state" };
}

export const cancelFamilySeat = (
  db: SharedD1Client,
  seatId: string,
  at = new Date(),
): Promise<FamilySeatMutationResult> =>
  terminateSeat(db, { seatId, expected: ["invited"], next: "cancelled", at });

export const removeFamilySeat = (
  db: SharedD1Client,
  seatId: string,
  at = new Date(),
): Promise<FamilySeatMutationResult> =>
  terminateSeat(db, { seatId, expected: ["active"], next: "removed", at });

export async function leaveFamilySeat(
  db: SharedD1Client,
  memberAccountId: string,
  at = new Date(),
): Promise<FamilySeatMutationResult> {
  const seat = await db
    .select({ id: familySeats.id })
    .from(familySeats)
    .where(
      and(
        eq(familySeats.memberAccountId, memberAccountId),
        eq(familySeats.status, "active"),
        eq(familySeats.role, "member"),
        eq(familySeats.isDeleted, false),
      ),
    )
    .get();
  return seat
    ? terminateSeat(db, { seatId: seat.id, expected: ["active"], next: "left", at })
    : { type: "not-found" };
}

export async function endFamilyPack(
  db: SharedD1Client,
  payerAccountId: string,
  at = new Date(),
): Promise<FamilyPackReadModel | null> {
  const current = await readFamilyPackByPayer(db, payerAccountId);
  if (!current) return null;
  await db.batch([
    db
      .update(familyPacks)
      .set({ status: "ended", endedAt: at, updatedAt: at })
      .where(and(eq(familyPacks.id, current.pack.id), eq(familyPacks.status, "active"))),
    db
      .update(familySeats)
      .set({ status: "ended", terminatedAt: at, updatedAt: at })
      .where(
        and(
          eq(familySeats.packId, current.pack.id),
          inArray(familySeats.status, ["invited", "active"]),
        ),
      ),
  ]);
  const pack = await db.select().from(familyPacks).where(eq(familyPacks.id, current.pack.id)).get();
  const seats = await db
    .select()
    .from(familySeats)
    .where(eq(familySeats.packId, current.pack.id))
    .orderBy(asc(familySeats.slotNumber), asc(familySeats.createdAt))
    .all();
  return pack ? { pack: packModel(pack), seats: seats.map(seatModel) } : null;
}
