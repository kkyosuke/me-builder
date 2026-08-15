import {
  type AcceptCompatibilityInvitationInput,
  type AcceptCompatibilityInvitationResult,
  type CancelCompatibilityInvitationResult,
  type CompatibilityInvitationAcceptanceContext,
  type CompatibilityInvitationPreview,
  type CompatibilityPairProgression,
  type CompatibilityPairProgressionSnapshot,
  type CompatibilityPairThemeFingerprint,
  type CompatibilityRelationship,
  type CreateCompatibilityInvitationInput,
  type CreateCompatibilityInvitationResult,
  type EndCompatibilityRelationshipResult,
  compatibilityPairProgressionLevel,
  compatibilityPairProgressionMarks,
  compatibilityPairProgressionThreshold,
  createCompatibilityInvitationAcceptanceContext,
  createCompatibilityInvitationPreview,
  decideCompatibilityInvitationAcceptance,
  decideCompatibilityInvitationCancellation,
  decideCompatibilityInvitationCreation,
  decideCompatibilityRelationshipEnd,
  expireCompatibilityRelationship,
  getAcceptedCompatibilityRelationship,
} from "@me-builder/lib";
import { eq } from "drizzle-orm";
import { type DrizzleSqliteDODatabase, drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/compatibility-data/migrations.js";
import {
  compatibilityAcceptedThemes,
  compatibilityDataSchema,
  compatibilityOfferedThemes,
  compatibilityProgressionStates,
  compatibilityProgressionThemes,
  compatibilityRelationships,
} from "./schema";

type CompatibilityDatabase = DrizzleSqliteDODatabase<typeof compatibilityDataSchema>;

const RELATIONSHIP_CATEGORY_RECOVERY_TABLE = "compatibility_relationship_category_recovery";

type LegacyRelationshipRow = Readonly<{
  singleton: number;
  relationship_id: string;
  inviter_account_id: string;
  invitee_account_id: string | null;
  inviter_display_name: string;
  invitee_display_name: string | null;
  offered_profile_summary_version_id?: string | null;
  offered_profile_fingerprint?: string | null;
  offered_profile_consented_at?: number | null;
  accepted_profile_summary_version_id?: string | null;
  accepted_profile_fingerprint?: string | null;
  accepted_profile_consented_at?: number | null;
  status: "pending" | "accepted" | "cancelled" | "expired" | "ended";
  expires_at: number;
  accepted_at: number | null;
  cancelled_at: number | null;
  ended_at: number | null;
  ended_by_account_id: string | null;
  created_at: number;
  updated_at: number;
}>;

type LegacyThemeRow = Readonly<{
  relationship_id: string;
  diagnosis_id: string;
  result_fingerprint: string;
  consented_at: number;
}>;

type RelationshipCategoryRecovery = Readonly<{
  relationship: LegacyRelationshipRow;
  offeredThemes: readonly LegacyThemeRow[];
  acceptedThemes: readonly LegacyThemeRow[];
}>;

export class CompatibilityDataRepository {
  private readonly db: CompatibilityDatabase;

  constructor(private readonly storage: DurableObjectStorage) {
    this.db = drizzle(storage, { schema: compatibilityDataSchema });
  }

  async initialize(): Promise<void> {
    this.backUpRelationshipBeforeCategoryMigration();
    await migrate(this.db, migrations);
    this.restoreRelationshipAfterCategoryMigration();
    const relationship = this.readRelationship();
    if (relationship?.status === "ended") {
      this.clearRelationshipDetails(relationship.updatedAt);
    }
  }

  createInvitation(
    relationshipId: string,
    input: CreateCompatibilityInvitationInput,
    createdAt: Date,
  ): CreateCompatibilityInvitationResult {
    const existing = this.readRelationship();
    const decision = decideCompatibilityInvitationCreation(
      existing,
      relationshipId,
      input,
      createdAt,
    );
    if (decision.outcome === "unchanged") return decision;
    const { relationship } = decision;

    this.db
      .insert(compatibilityRelationships)
      .values({
        singleton: 1,
        relationshipId: relationship.id,
        inviterAccountId: relationship.inviterAccountId,
        inviteeAccountId: relationship.inviteeAccountId,
        inviterDisplayName: relationship.inviterDisplayName,
        inviteeDisplayName: relationship.inviteeDisplayName,
        relationshipCategory: relationship.relationshipCategory,
        status: relationship.status,
        expiresAt: relationship.expiresAt,
        acceptedAt: relationship.acceptedAt,
        cancelledAt: relationship.cancelledAt,
        endedAt: relationship.endedAt,
        endedByAccountId: relationship.endedByAccountId,
        createdAt: relationship.createdAt,
        updatedAt: relationship.updatedAt,
      })
      .run();

    const persisted = this.readRelationship();
    if (!persisted) throw new Error("Compatibility invitation was not persisted");
    return { outcome: "created", relationship: persisted };
  }

  getInvitationPreview(viewerAccountId: string, at: Date): CompatibilityInvitationPreview | null {
    this.expirePending(at);
    return createCompatibilityInvitationPreview(this.readRelationship(), viewerAccountId, at);
  }

  getInvitationAcceptanceContext(at: Date): CompatibilityInvitationAcceptanceContext | null {
    this.expirePending(at);
    return createCompatibilityInvitationAcceptanceContext(this.readRelationship(), at);
  }

  acceptInvitation(
    input: AcceptCompatibilityInvitationInput,
    acceptedAt: Date,
  ): AcceptCompatibilityInvitationResult {
    this.expirePending(acceptedAt);
    const relationship = this.readRelationship();
    const decision = decideCompatibilityInvitationAcceptance(relationship, input, acceptedAt);
    if (decision.outcome !== "accepted") return decision;
    const acceptedRelationship = decision.relationship;

    this.db
      .update(compatibilityRelationships)
      .set({
        inviteeAccountId: acceptedRelationship.inviteeAccountId,
        inviteeDisplayName: acceptedRelationship.inviteeDisplayName,
        status: acceptedRelationship.status,
        acceptedAt: acceptedRelationship.acceptedAt,
        updatedAt: acceptedRelationship.updatedAt,
      })
      .where(eq(compatibilityRelationships.singleton, 1))
      .run();

    const accepted = this.readRelationship();
    if (!accepted) throw new Error("Accepted compatibility relationship was not persisted");
    return { outcome: "accepted", relationship: accepted };
  }

  cancelInvitation(actorAccountId: string, at: Date): CancelCompatibilityInvitationResult {
    this.expirePending(at);
    const relationship = this.readRelationship();
    const decision = decideCompatibilityInvitationCancellation(relationship, actorAccountId, at);
    if (decision.outcome !== "cancelled") return decision;
    this.db
      .update(compatibilityRelationships)
      .set({
        status: decision.relationship.status,
        cancelledAt: decision.relationship.cancelledAt,
        updatedAt: decision.relationship.updatedAt,
      })
      .where(eq(compatibilityRelationships.singleton, 1))
      .run();
    const cancelled = this.readRelationship();
    if (!cancelled) throw new Error("Cancelled compatibility invitation was not persisted");
    return { outcome: "cancelled", relationship: cancelled };
  }

  getRelationship(actorAccountId: string, at: Date): CompatibilityRelationship | null {
    this.expirePending(at);
    return getAcceptedCompatibilityRelationship(this.readRelationship(), actorAccountId);
  }

  synchronizeProgression(
    actorAccountId: string,
    themes: readonly CompatibilityPairThemeFingerprint[],
    at: Date,
  ): CompatibilityPairProgression | null {
    if (!this.getRelationship(actorAccountId, at)) return null;
    const uniqueThemes = [...new Map(themes.map((theme) => [theme.diagnosisId, theme])).values()]
      .filter(({ diagnosisId, fingerprint }) => diagnosisId.length > 0 && fingerprint.length > 0)
      .sort((left, right) => left.diagnosisId.localeCompare(right.diagnosisId));
    const existingThemes = new Map(
      this.db
        .select()
        .from(compatibilityProgressionThemes)
        .all()
        .map((theme) => [theme.diagnosisId, theme] as const),
    );
    const existingState = this.db
      .select()
      .from(compatibilityProgressionStates)
      .where(eq(compatibilityProgressionStates.singleton, 1))
      .get();
    const restoringBaseline =
      existingState !== undefined &&
      existingState.growthValue !== 0 &&
      existingState.comparableThemeCount === 0 &&
      existingThemes.size === 0;
    let growthDelta = 0;
    const themeChanges: Array<
      | { type: "insert"; theme: CompatibilityPairThemeFingerprint }
      | { type: "update"; theme: CompatibilityPairThemeFingerprint }
    > = [];
    for (const theme of uniqueThemes) {
      const existing = existingThemes.get(theme.diagnosisId);
      if (!existing) {
        if (!restoringBaseline) growthDelta += 3;
        themeChanges.push({ type: "insert", theme });
      } else if (existing.resultFingerprint !== theme.fingerprint) {
        growthDelta += 1;
        themeChanges.push({ type: "update", theme });
      }
    }
    const growthValue = (existingState?.growthValue ?? 0) + growthDelta;
    const level = compatibilityPairProgressionLevel(growthValue);
    const highestLevel = Math.max(existingState?.highestLevel ?? 1, level);
    const comparableThemeCount = uniqueThemes.length;
    const shouldUpdateState =
      !existingState ||
      growthDelta > 0 ||
      existingState.comparableThemeCount !== comparableThemeCount;
    if (themeChanges.length > 0 || shouldUpdateState) {
      this.storage.transactionSync(() => {
        for (const change of themeChanges) {
          if (change.type === "insert") {
            this.db
              .insert(compatibilityProgressionThemes)
              .values({
                diagnosisId: change.theme.diagnosisId,
                resultFingerprint: change.theme.fingerprint,
                firstComparedAt: at,
                updatedAt: at,
              })
              .run();
          } else {
            this.db
              .update(compatibilityProgressionThemes)
              .set({ resultFingerprint: change.theme.fingerprint, updatedAt: at })
              .where(eq(compatibilityProgressionThemes.diagnosisId, change.theme.diagnosisId))
              .run();
          }
        }
        if (shouldUpdateState) {
          this.db
            .insert(compatibilityProgressionStates)
            .values({
              singleton: 1,
              growthValue,
              highestLevel,
              comparableThemeCount,
              createdAt: existingState?.createdAt ?? at,
              updatedAt: at,
            })
            .onConflictDoUpdate({
              target: compatibilityProgressionStates.singleton,
              set: { growthValue, highestLevel, comparableThemeCount, updatedAt: at },
            })
            .run();
        }
      });
    }
    return {
      level: highestLevel,
      growthValue,
      currentLevelThreshold: compatibilityPairProgressionThreshold(highestLevel),
      nextLevelThreshold: compatibilityPairProgressionThreshold(highestLevel + 1),
      comparableThemeCount,
      marks: compatibilityPairProgressionMarks(highestLevel),
    };
  }

  getProgressionSnapshot(actorAccountId: string): CompatibilityPairProgressionSnapshot | null {
    const relationship = this.readRelationship();
    if (
      !relationship ||
      (relationship.status !== "accepted" && relationship.status !== "ended") ||
      (relationship.inviterAccountId !== actorAccountId &&
        relationship.inviteeAccountId !== actorAccountId)
    ) {
      return null;
    }
    return this.readProgressionSnapshot();
  }

  restoreProgressionSnapshot(
    actorAccountId: string,
    snapshot: CompatibilityPairProgressionSnapshot,
    at: Date,
  ): boolean {
    if (!this.getRelationship(actorAccountId, at)) return false;
    return this.mergeProgressionSnapshot(snapshot, at);
  }

  readProgressionArchive(): CompatibilityPairProgressionSnapshot | null {
    if (this.readRelationship()) return null;
    return this.readProgressionSnapshot();
  }

  mergeProgressionArchive(snapshot: CompatibilityPairProgressionSnapshot, at: Date): void {
    if (this.readRelationship()) {
      throw new Error("Progression archive cannot share a relationship object");
    }
    this.mergeProgressionSnapshot(snapshot, at);
  }

  endRelationship(actorAccountId: string, at: Date): EndCompatibilityRelationshipResult {
    const relationship = this.readRelationship();
    const decision = decideCompatibilityRelationshipEnd(relationship, actorAccountId, at);
    if (decision.outcome !== "ended") return decision;
    this.storage.transactionSync(() => {
      this.db
        .update(compatibilityRelationships)
        .set({
          status: decision.relationship.status,
          endedAt: decision.relationship.endedAt,
          endedByAccountId: decision.relationship.endedByAccountId,
          offeredProfileSummaryVersionId: null,
          offeredProfileFingerprint: null,
          offeredProfileConsentedAt: null,
          acceptedProfileSummaryVersionId: null,
          acceptedProfileFingerprint: null,
          acceptedProfileConsentedAt: null,
          updatedAt: decision.relationship.updatedAt,
        })
        .where(eq(compatibilityRelationships.singleton, 1))
        .run();
      this.db.delete(compatibilityAcceptedThemes).run();
      this.db.delete(compatibilityOfferedThemes).run();
      this.db.delete(compatibilityProgressionThemes).run();
      this.db
        .update(compatibilityProgressionStates)
        .set({ comparableThemeCount: 0, updatedAt: at })
        .where(eq(compatibilityProgressionStates.singleton, 1))
        .run();
    });
    const ended = this.readRelationship();
    if (!ended) throw new Error("Ended compatibility relationship was not persisted");
    return { outcome: "ended", relationship: ended };
  }

  expirePending(at: Date): boolean {
    const relationship = this.readRelationship();
    if (!relationship) return false;
    const expired = expireCompatibilityRelationship(relationship, at);
    if (expired === relationship) return false;
    this.db
      .update(compatibilityRelationships)
      .set({ status: expired.status, updatedAt: expired.updatedAt })
      .where(eq(compatibilityRelationships.singleton, 1))
      .run();
    return true;
  }

  private readProgressionSnapshot(): CompatibilityPairProgressionSnapshot | null {
    const state = this.db
      .select()
      .from(compatibilityProgressionStates)
      .where(eq(compatibilityProgressionStates.singleton, 1))
      .get();
    if (!state) return null;
    return {
      growthValue: state.growthValue,
      highestLevel: state.highestLevel,
    };
  }

  private mergeProgressionSnapshot(
    snapshot: CompatibilityPairProgressionSnapshot,
    at: Date,
  ): boolean {
    const existing = this.db
      .select()
      .from(compatibilityProgressionStates)
      .where(eq(compatibilityProgressionStates.singleton, 1))
      .get();
    if (
      existing &&
      (existing.growthValue > snapshot.growthValue ||
        (existing.growthValue === snapshot.growthValue &&
          existing.highestLevel >= snapshot.highestLevel))
    ) {
      return false;
    }
    this.storage.transactionSync(() => {
      this.db.delete(compatibilityProgressionThemes).run();
      this.db
        .insert(compatibilityProgressionStates)
        .values({
          singleton: 1,
          growthValue: snapshot.growthValue,
          highestLevel: snapshot.highestLevel,
          comparableThemeCount: 0,
          createdAt: existing?.createdAt ?? at,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: compatibilityProgressionStates.singleton,
          set: {
            growthValue: snapshot.growthValue,
            highestLevel: snapshot.highestLevel,
            comparableThemeCount: 0,
            updatedAt: at,
          },
        })
        .run();
    });
    return true;
  }

  private readRelationship(): CompatibilityRelationship | null {
    const relationship = this.db
      .select()
      .from(compatibilityRelationships)
      .where(eq(compatibilityRelationships.singleton, 1))
      .get();
    if (!relationship) return null;
    return {
      id: relationship.relationshipId,
      inviterAccountId: relationship.inviterAccountId,
      inviteeAccountId: relationship.inviteeAccountId,
      inviterDisplayName: relationship.inviterDisplayName,
      inviteeDisplayName: relationship.inviteeDisplayName,
      relationshipCategory: relationship.relationshipCategory,
      status: relationship.status,
      expiresAt: relationship.expiresAt,
      acceptedAt: relationship.acceptedAt,
      cancelledAt: relationship.cancelledAt,
      endedAt: relationship.endedAt,
      endedByAccountId: relationship.endedByAccountId,
      createdAt: relationship.createdAt,
      updatedAt: relationship.updatedAt,
    };
  }

  /** 既定値なしのNOT NULL column追加を、既存関係を失わず前進適用できるようにする。 */
  private backUpRelationshipBeforeCategoryMigration(): void {
    const columns = this.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(compatibility_relationships)")
      .toArray();
    if (columns.length === 0 || columns.some(({ name }) => name === "relationship_category")) {
      return;
    }
    const relationship = this.storage.sql
      .exec<LegacyRelationshipRow>("SELECT * FROM compatibility_relationships")
      .toArray()[0];
    if (!relationship) return;
    const recovery: RelationshipCategoryRecovery = {
      relationship,
      offeredThemes: this.storage.sql
        .exec<LegacyThemeRow>("SELECT * FROM compatibility_offered_themes")
        .toArray(),
      acceptedThemes: this.storage.sql
        .exec<LegacyThemeRow>("SELECT * FROM compatibility_accepted_themes")
        .toArray(),
    };
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS ${RELATIONSHIP_CATEGORY_RECOVERY_TABLE} (
          singleton integer PRIMARY KEY NOT NULL,
          recovery_json text NOT NULL
        )`,
      );
      this.storage.sql.exec(
        `INSERT INTO ${RELATIONSHIP_CATEGORY_RECOVERY_TABLE} (singleton, recovery_json)
         VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET recovery_json = excluded.recovery_json`,
        JSON.stringify(recovery),
      );
      this.storage.sql.exec("DELETE FROM compatibility_accepted_themes");
      this.storage.sql.exec("DELETE FROM compatibility_offered_themes");
      this.storage.sql.exec("DELETE FROM compatibility_relationships");
    });
  }

  /** 退避済みの旧関係を、カテゴリへの暗黙同意を作らない終端状態で復元する。 */
  private restoreRelationshipAfterCategoryMigration(): void {
    const recoveryTable = this.storage.sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        RELATIONSHIP_CATEGORY_RECOVERY_TABLE,
      )
      .toArray()[0];
    if (!recoveryTable) return;
    const recoveryRow = this.storage.sql
      .exec<{ recovery_json: string }>(
        `SELECT recovery_json FROM ${RELATIONSHIP_CATEGORY_RECOVERY_TABLE} WHERE singleton = 1`,
      )
      .toArray()[0];
    if (!recoveryRow) throw new Error("Compatibility relationship migration recovery is missing");
    const recovery = JSON.parse(recoveryRow.recovery_json) as RelationshipCategoryRecovery;
    const relationship = recovery.relationship;
    const status =
      relationship.status === "pending"
        ? "cancelled"
        : relationship.status === "accepted"
          ? "ended"
          : relationship.status;
    const cancelledAt =
      relationship.status === "pending" ? relationship.updated_at : relationship.cancelled_at;
    const endedAt =
      relationship.status === "accepted" ? relationship.updated_at : relationship.ended_at;

    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        `INSERT OR IGNORE INTO compatibility_relationships (
          singleton, relationship_id, inviter_account_id, invitee_account_id,
          inviter_display_name, invitee_display_name,
          offered_profile_summary_version_id, offered_profile_fingerprint,
          offered_profile_consented_at, accepted_profile_summary_version_id,
          accepted_profile_fingerprint, accepted_profile_consented_at,
          relationship_category, status, expires_at, accepted_at, cancelled_at,
          ended_at, ended_by_account_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'friend', ?, ?, ?, ?, ?, ?, ?, ?)`,
        relationship.singleton,
        relationship.relationship_id,
        relationship.inviter_account_id,
        relationship.invitee_account_id,
        relationship.inviter_display_name,
        relationship.invitee_display_name,
        relationship.offered_profile_summary_version_id ?? null,
        relationship.offered_profile_fingerprint ?? null,
        relationship.offered_profile_consented_at ?? null,
        relationship.accepted_profile_summary_version_id ?? null,
        relationship.accepted_profile_fingerprint ?? null,
        relationship.accepted_profile_consented_at ?? null,
        status,
        relationship.expires_at,
        relationship.accepted_at,
        cancelledAt,
        endedAt,
        relationship.ended_by_account_id,
        relationship.created_at,
        relationship.updated_at,
      );
      for (const theme of recovery.offeredThemes) {
        this.storage.sql.exec(
          `INSERT OR IGNORE INTO compatibility_offered_themes
            (relationship_id, diagnosis_id, result_fingerprint, consented_at)
           VALUES (?, ?, ?, ?)`,
          theme.relationship_id,
          theme.diagnosis_id,
          theme.result_fingerprint,
          theme.consented_at,
        );
      }
      for (const theme of recovery.acceptedThemes) {
        this.storage.sql.exec(
          `INSERT OR IGNORE INTO compatibility_accepted_themes
            (relationship_id, diagnosis_id, result_fingerprint, consented_at)
           VALUES (?, ?, ?, ?)`,
          theme.relationship_id,
          theme.diagnosis_id,
          theme.result_fingerprint,
          theme.consented_at,
        );
      }
      this.storage.sql.exec(`DROP TABLE ${RELATIONSHIP_CATEGORY_RECOVERY_TABLE}`);
    });
  }

  /** 修正前に終了済みの関係も、内容を復元できない累積値と最高到達レベルだけ残す。 */
  private clearRelationshipDetails(at: Date): void {
    const relationshipDetails = this.db
      .select({
        offeredProfileSummaryVersionId: compatibilityRelationships.offeredProfileSummaryVersionId,
        offeredProfileFingerprint: compatibilityRelationships.offeredProfileFingerprint,
        offeredProfileConsentedAt: compatibilityRelationships.offeredProfileConsentedAt,
        acceptedProfileSummaryVersionId: compatibilityRelationships.acceptedProfileSummaryVersionId,
        acceptedProfileFingerprint: compatibilityRelationships.acceptedProfileFingerprint,
        acceptedProfileConsentedAt: compatibilityRelationships.acceptedProfileConsentedAt,
      })
      .from(compatibilityRelationships)
      .where(eq(compatibilityRelationships.singleton, 1))
      .get();
    const offeredTheme = this.db.select().from(compatibilityOfferedThemes).get();
    const acceptedTheme = this.db.select().from(compatibilityAcceptedThemes).get();
    const progressionTheme = this.db.select().from(compatibilityProgressionThemes).get();
    const state = this.db
      .select({ comparableThemeCount: compatibilityProgressionStates.comparableThemeCount })
      .from(compatibilityProgressionStates)
      .where(eq(compatibilityProgressionStates.singleton, 1))
      .get();
    const hasRelationshipDetails =
      relationshipDetails && Object.values(relationshipDetails).some((value) => value !== null);
    if (
      !hasRelationshipDetails &&
      !offeredTheme &&
      !acceptedTheme &&
      !progressionTheme &&
      (!state || state.comparableThemeCount === 0)
    ) {
      return;
    }
    this.storage.transactionSync(() => {
      this.db
        .update(compatibilityRelationships)
        .set({
          offeredProfileSummaryVersionId: null,
          offeredProfileFingerprint: null,
          offeredProfileConsentedAt: null,
          acceptedProfileSummaryVersionId: null,
          acceptedProfileFingerprint: null,
          acceptedProfileConsentedAt: null,
          updatedAt: at,
        })
        .where(eq(compatibilityRelationships.singleton, 1))
        .run();
      this.db.delete(compatibilityAcceptedThemes).run();
      this.db.delete(compatibilityOfferedThemes).run();
      this.db.delete(compatibilityProgressionThemes).run();
      this.db
        .update(compatibilityProgressionStates)
        .set({ comparableThemeCount: 0, updatedAt: at })
        .where(eq(compatibilityProgressionStates.singleton, 1))
        .run();
    });
  }
}
