import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const compatibilityRelationships = sqliteTable(
  "compatibility_relationships",
  {
    singleton: integer("singleton").primaryKey(),
    relationshipId: text("relationship_id").notNull().unique(),
    inviterAccountId: text("inviter_account_id").notNull(),
    inviteeAccountId: text("invitee_account_id"),
    inviterDisplayName: text("inviter_display_name").notNull(),
    inviteeDisplayName: text("invitee_display_name"),
    relationshipCategory: text("relationship_category", {
      enum: ["partner", "family", "friend", "work"],
    }).notNull(),
    // 表示内容単位の同意を廃止したため書き込まない。削除は後続releaseのcontractで行う。
    offeredProfileSummaryVersionId: text("offered_profile_summary_version_id"),
    offeredProfileFingerprint: text("offered_profile_fingerprint"),
    offeredProfileConsentedAt: integer("offered_profile_consented_at", {
      mode: "timestamp_ms",
    }),
    acceptedProfileSummaryVersionId: text("accepted_profile_summary_version_id"),
    acceptedProfileFingerprint: text("accepted_profile_fingerprint"),
    acceptedProfileConsentedAt: integer("accepted_profile_consented_at", {
      mode: "timestamp_ms",
    }),
    status: text("status", {
      enum: ["pending", "accepted", "cancelled", "expired", "ended"],
    })
      .notNull()
      .default("pending"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    endedByAccountId: text("ended_by_account_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("compatibility_relationship_singleton_check", sql`${table.singleton} = 1`),
    check(
      "compatibility_relationship_participant_check",
      sql`${table.inviteeAccountId} is null or ${table.inviteeAccountId} <> ${table.inviterAccountId}`,
    ),
    check(
      "compatibility_relationship_accepted_participant_check",
      sql`${table.status} <> 'accepted' or (${table.inviteeAccountId} is not null and ${table.inviteeDisplayName} is not null and ${table.acceptedAt} is not null and ((${table.acceptedProfileSummaryVersionId} is null and ${table.acceptedProfileFingerprint} is null and ${table.acceptedProfileConsentedAt} is null) or (${table.acceptedProfileSummaryVersionId} is not null and ${table.acceptedProfileFingerprint} is not null and ${table.acceptedProfileConsentedAt} is not null)))`,
    ),
  ],
);

/** 表示内容単位の同意を廃止した後は書き込まない。削除は後続releaseのcontractで行う。 */
export const compatibilityOfferedThemes = sqliteTable(
  "compatibility_offered_themes",
  {
    relationshipId: text("relationship_id")
      .notNull()
      .references(() => compatibilityRelationships.relationshipId, { onDelete: "cascade" }),
    diagnosisId: text("diagnosis_id").notNull(),
    resultFingerprint: text("result_fingerprint").notNull(),
    consentedAt: integer("consented_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.relationshipId, table.diagnosisId] })],
);

/** 表示内容単位の同意を廃止した後は書き込まない。削除は後続releaseのcontractで行う。 */
export const compatibilityAcceptedThemes = sqliteTable(
  "compatibility_accepted_themes",
  {
    relationshipId: text("relationship_id").notNull(),
    diagnosisId: text("diagnosis_id").notNull(),
    resultFingerprint: text("result_fingerprint").notNull(),
    consentedAt: integer("consented_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.relationshipId, table.diagnosisId] }),
    foreignKey({
      columns: [table.relationshipId, table.diagnosisId],
      foreignColumns: [
        compatibilityOfferedThemes.relationshipId,
        compatibilityOfferedThemes.diagnosisId,
      ],
    }).onDelete("cascade"),
  ],
);

export const compatibilityDataSchema = {
  compatibilityAcceptedThemes,
  compatibilityOfferedThemes,
  compatibilityRelationships,
};
