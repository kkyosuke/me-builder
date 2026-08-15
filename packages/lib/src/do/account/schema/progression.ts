import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { baseSchema } from "../../../table/base";
import { accountDataIdentity } from "./identity";

/** 内容を保持せず、うつしレベルへ一度だけ反映したBrain上の出来事を記録する。 */
export const progressionEvents = sqliteTable(
  "progression_events",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    originType: text("origin_type", {
      enum: ["initialization", "brain_item", "evidence"],
    }).notNull(),
    originId: text("origin_id").notNull(),
    kind: text("kind", {
      enum: [
        "initialization",
        "new_item",
        "evidence_added",
        "temporal_revision",
        "correction_revision",
        "inference_item",
      ],
    }).notNull(),
    growthDelta: integer("growth_delta").notNull(),
    collectedPieceDelta: integer("collected_piece_delta").notNull(),
  },
  (table) => [
    uniqueIndex("progression_event_origin_idx").on(
      table.accountId,
      table.originType,
      table.originId,
    ),
    index("progression_event_account_idx").on(table.accountId, table.isDeleted),
  ],
);
