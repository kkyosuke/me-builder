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
        "initial_evidence",
        "evidence_added",
        "duplicate_evidence",
        "ignored_evidence",
        "temporal_revision",
        "correction_revision",
        "inference_item",
      ],
    }).notNull(),
    calculationVersion: integer("calculation_version").notNull().default(1),
    growthDelta: integer("growth_delta").notNull(),
    collectedPieceDelta: integer("collected_piece_delta").notNull(),
    category: text("category"),
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

/** プロフィール取得時に全イベントを再集計しないためのAccount単位の累積値。 */
export const progressionStates = sqliteTable(
  "progression_states",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    growthValue: integer("growth_value").notNull().default(0),
    collectedPieces: integer("collected_pieces").notNull().default(0),
    calculationVersion: integer("calculation_version").notNull().default(1),
    highestLevel: integer("highest_level").notNull().default(1),
  },
  (table) => [uniqueIndex("progression_state_account_idx").on(table.accountId)],
);

/** ItemごとのEvidence累計。新しいEvidenceの加点判定を履歴走査なしで行う。 */
export const progressionItemStates = sqliteTable(
  "progression_item_states",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    brainItemId: text("brain_item_id").notNull(),
    recognizedEvidenceCount: integer("recognized_evidence_count").notNull().default(0),
    recognizedEvidenceFingerprintsJson: text("recognized_evidence_fingerprints_json")
      .notNull()
      .default("[]"),
  },
  (table) => [
    uniqueIndex("progression_item_state_item_idx").on(table.accountId, table.brainItemId),
  ],
);

/** 10レベルごとの成長カード。本文を持たず、到達時点の集計だけを保存する。 */
export const progressionMilestones = sqliteTable(
  "progression_milestones",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    level: integer("level").notNull(),
    collectedPiecesDelta: integer("collected_pieces_delta").notNull(),
    collectedPiecesTotal: integer("collected_pieces_total").notNull(),
    categoriesJson: text("categories_json").notNull().default("[]"),
  },
  (table) => [
    uniqueIndex("progression_milestone_account_level_idx").on(table.accountId, table.level),
  ],
);

/** Brain更新batchで積み、次の進行度読込時に差分だけを反映する。 */
export const progressionPendingEvents = sqliteTable(
  "progression_pending_events",
  {
    ...baseSchema,
    accountId: text("account_id")
      .notNull()
      .references(() => accountDataIdentity.accountId),
    originType: text("origin_type", { enum: ["brain_item", "evidence"] }).notNull(),
    originId: text("origin_id").notNull(),
  },
  (table) => [
    uniqueIndex("progression_pending_origin_idx").on(
      table.accountId,
      table.originType,
      table.originId,
    ),
    index("progression_pending_account_idx").on(table.accountId),
  ],
);
