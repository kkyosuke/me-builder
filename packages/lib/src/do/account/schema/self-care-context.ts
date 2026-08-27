import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { selfCareConfirmationKinds } from "../../../self-care-context";
import { brainItems } from "./brain";
import { accountDataIdentity } from "./identity";

export const selfCareConfirmations = sqliteTable(
  "self_care_confirmations",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    brainItemId: text("brain_item_id")
      .notNull()
      .references(() => brainItems.id),
    kind: text("kind", { enum: selfCareConfirmationKinds }).notNull(),
    status: text("status", { enum: ["active", "revoked"] }).notNull(),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("self_care_confirmation_brain_kind_idx").on(
      table.accountId,
      table.brainItemId,
      table.kind,
    ),
    index("self_care_confirmation_active_idx").on(
      table.accountId,
      table.status,
      table.kind,
      table.updatedAt,
    ),
  ],
);
