import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "./account";

/** AccountDataから共有D1へ出す、管理者一覧用の非機密な成長集計。 */
export const accountProgressionProjections = sqliteTable(
  "account_progression_projections",
  {
    accountId: text("account_id")
      .primaryKey()
      .references(() => accounts.id),
    calculationVersion: integer("calculation_version").notNull(),
    level: integer("level").notNull(),
    growthValue: integer("growth_value").notNull(),
    collectedPieces: integer("collected_pieces").notNull(),
    activePieces: integer("active_pieces").notNull(),
    lastGrowthAt: integer("last_growth_at", { mode: "timestamp_ms" }),
    projectedAt: integer("projected_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "account_progression_projection_values_check",
      sql`${table.calculationVersion} > 0 and ${table.level} > 0 and ${table.growthValue} >= 0 and ${table.collectedPieces} >= 0 and ${table.activePieces} >= 0`,
    ),
    index("account_progression_level_idx").on(table.level, table.accountId),
    index("account_progression_pieces_idx").on(table.collectedPieces, table.accountId),
    index("account_progression_growth_at_idx").on(table.lastGrowthAt, table.accountId),
  ],
);
