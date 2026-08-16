import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brainItems } from "./brain";
import { accountDataIdentity } from "./identity";

export const goalFollowUps = sqliteTable(
  "goal_follow_ups",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    brainItemId: text("brain_item_id")
      .notNull()
      .references(() => brainItems.id),
    nextStep: text("next_step").notNull(),
    status: text("status", { enum: ["active", "completed", "stopped"] }).notNull(),
    agreedAt: integer("agreed_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("goal_follow_up_brain_item_idx").on(table.accountId, table.brainItemId),
    index("goal_follow_up_active_idx").on(table.accountId, table.status, table.updatedAt),
  ],
);
