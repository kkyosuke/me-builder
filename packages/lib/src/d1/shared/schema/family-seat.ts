import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { baseSchema } from "../../../table/base";
import { accounts } from "./account";

export const familyPacks = sqliteTable(
  "family_packs",
  {
    ...baseSchema,
    payerAccountId: text("payer_account_id")
      .notNull()
      .references(() => accounts.id),
    status: text("status", { enum: ["active", "ended"] }).notNull(),
    maxSeats: integer("max_seats").notNull().default(4),
    endedAt: integer("ended_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("family_pack_active_payer_idx")
      .on(table.payerAccountId)
      .where(sql`status = 'active' and is_deleted = 0`),
    check("family_pack_max_seats_check", sql`${table.maxSeats} = 4`),
  ],
);

export const familySeats = sqliteTable(
  "family_seats",
  {
    ...baseSchema,
    packId: text("pack_id")
      .notNull()
      .references(() => familyPacks.id),
    slotNumber: integer("slot_number").notNull(),
    role: text("role", { enum: ["payer", "member"] }).notNull(),
    memberAccountId: text("member_account_id").references(() => accounts.id),
    invitationId: text("invitation_id"),
    status: text("status", {
      enum: ["invited", "active", "left", "cancelled", "removed", "ended"],
    }).notNull(),
    activatedAt: integer("activated_at", { mode: "timestamp" }),
    terminatedAt: integer("terminated_at", { mode: "timestamp" }),
  },
  (table) => [
    check("family_seat_slot_check", sql`${table.slotNumber} between 1 and 4`),
    check(
      "family_seat_role_check",
      sql`(${table.role} = 'payer' and ${table.slotNumber} = 1 and ${table.memberAccountId} is not null and ${table.invitationId} is null and ${table.status} in ('active', 'ended')) or (${table.role} = 'member' and ${table.slotNumber} between 2 and 4)`,
    ),
    check(
      "family_seat_state_check",
      sql`(${table.status} = 'invited' and ${table.memberAccountId} is null and ${table.invitationId} is not null and ${table.activatedAt} is null and ${table.terminatedAt} is null) or (${table.status} = 'active' and ${table.memberAccountId} is not null and ${table.activatedAt} is not null and ${table.terminatedAt} is null) or (${table.status} in ('left', 'cancelled', 'removed', 'ended') and ${table.terminatedAt} is not null)`,
    ),
    uniqueIndex("family_seat_live_slot_idx")
      .on(table.packId, table.slotNumber)
      .where(sql`status in ('invited', 'active') and is_deleted = 0`),
    uniqueIndex("family_seat_active_account_idx")
      .on(table.memberAccountId)
      .where(sql`status = 'active' and member_account_id is not null and is_deleted = 0`),
    uniqueIndex("family_seat_invitation_idx").on(table.invitationId),
    index("family_seat_pack_status_idx").on(table.packId, table.status, table.slotNumber),
  ],
);

export const familySeatInvitations = sqliteTable(
  "family_seat_invitations",
  {
    ...baseSchema,
    seatId: text("seat_id")
      .notNull()
      .references(() => familySeats.id),
    inviterAccountId: text("inviter_account_id")
      .notNull()
      .references(() => accounts.id),
    tokenHash: text("token_hash").notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "declined", "cancelled", "expired"],
    }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    claimedByAccountId: text("claimed_by_account_id").references(() => accounts.id),
    consumedAt: integer("consumed_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("family_seat_invitation_seat_idx").on(table.seatId),
    uniqueIndex("family_seat_invitation_token_idx").on(table.tokenHash),
    index("family_seat_invitation_status_expiry_idx").on(table.status, table.expiresAt),
    check(
      "family_seat_invitation_state_check",
      sql`(${table.status} = 'pending' and ${table.claimedByAccountId} is null and ${table.consumedAt} is null) or (${table.status} = 'accepted' and ${table.claimedByAccountId} is not null and ${table.consumedAt} is not null) or (${table.status} in ('declined', 'cancelled', 'expired') and ${table.consumedAt} is not null)`,
    ),
  ],
);
