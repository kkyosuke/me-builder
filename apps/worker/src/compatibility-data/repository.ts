import type {
  AcceptCompatibilityInvitationInput,
  AcceptCompatibilityInvitationResult,
  CancelCompatibilityInvitationResult,
  CompatibilityInvitationAcceptanceContext,
  CompatibilityInvitationPreview,
  CompatibilityRelationship,
  CompatibilityThemeConsent,
  CompatibilityThemeFingerprint,
  CreateCompatibilityInvitationInput,
  CreateCompatibilityInvitationResult,
  EndCompatibilityRelationshipResult,
} from "@me-builder/lib";
import { COMPATIBILITY_INVITATION_TTL_MS } from "@me-builder/lib";
import { asc, eq } from "drizzle-orm";
import { type DrizzleSqliteDODatabase, drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/compatibility-data/migrations.js";
import {
  compatibilityAcceptedThemes,
  compatibilityDataSchema,
  compatibilityOfferedThemes,
  compatibilityRelationships,
} from "./schema";

type CompatibilityDatabase = DrizzleSqliteDODatabase<typeof compatibilityDataSchema>;

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`${field} is required`);
}

function assertThemes(themes: readonly CompatibilityThemeFingerprint[]): void {
  if (themes.length === 0) throw new Error("At least one compatibility theme is required");
  const diagnosisIds = new Set<string>();
  for (const theme of themes) {
    assertNonEmpty(theme.diagnosisId, "diagnosisId");
    if (!/^[a-f0-9]{64}$/.test(theme.resultFingerprint)) {
      throw new Error("Compatibility result fingerprint must be a SHA-256 hex digest");
    }
    if (diagnosisIds.has(theme.diagnosisId)) {
      throw new Error("Compatibility themes must not contain duplicate diagnoses");
    }
    diagnosisIds.add(theme.diagnosisId);
  }
}

function sameThemes(
  left: readonly CompatibilityThemeConsent[],
  right: readonly CompatibilityThemeFingerprint[],
): boolean {
  if (left.length !== right.length) return false;
  const byDiagnosis = new Map(left.map((theme) => [theme.diagnosisId, theme]));
  return right.every((theme) => {
    const other = byDiagnosis.get(theme.diagnosisId);
    return other?.resultFingerprint === theme.resultFingerprint;
  });
}

export class CompatibilityDataRepository {
  private readonly db: CompatibilityDatabase;

  constructor(storage: DurableObjectStorage) {
    this.db = drizzle(storage, { schema: compatibilityDataSchema });
  }

  async initialize(): Promise<void> {
    await migrate(this.db, migrations);
  }

  createInvitation(
    relationshipId: string,
    input: CreateCompatibilityInvitationInput,
    createdAt: Date,
  ): CreateCompatibilityInvitationResult {
    assertNonEmpty(relationshipId, "relationshipId");
    if (!/^[a-f0-9]{64}$/.test(relationshipId)) {
      throw new Error("Compatibility relationship id must be a 256-bit hex token");
    }
    assertNonEmpty(input.inviterAccountId, "inviterAccountId");
    assertNonEmpty(input.inviterDisplayName, "inviterDisplayName");
    assertThemes(input.offeredThemes);
    const expiresAt = new Date(createdAt.getTime() + COMPATIBILITY_INVITATION_TTL_MS);

    const existing = this.readRelationship();
    if (existing) {
      if (
        existing.id !== relationshipId ||
        existing.inviterAccountId !== input.inviterAccountId ||
        existing.inviterDisplayName !== input.inviterDisplayName.trim() ||
        !sameThemes(existing.offeredThemes, input.offeredThemes)
      ) {
        throw new Error("Compatibility invitation conflicts with persisted relationship");
      }
      return { outcome: "unchanged", relationship: existing };
    }

    this.db.transaction((tx) => {
      tx.insert(compatibilityRelationships)
        .values({
          singleton: 1,
          relationshipId,
          inviterAccountId: input.inviterAccountId,
          inviteeAccountId: null,
          inviterDisplayName: input.inviterDisplayName.trim(),
          inviteeDisplayName: null,
          status: "pending",
          expiresAt,
          acceptedAt: null,
          cancelledAt: null,
          endedAt: null,
          endedByAccountId: null,
          createdAt,
          updatedAt: createdAt,
        })
        .run();
      tx.insert(compatibilityOfferedThemes)
        .values(
          input.offeredThemes.map((theme) => ({
            relationshipId,
            diagnosisId: theme.diagnosisId,
            resultFingerprint: theme.resultFingerprint,
            consentedAt: createdAt,
          })),
        )
        .run();
    });

    const relationship = this.readRelationship();
    if (!relationship) throw new Error("Compatibility invitation was not persisted");
    return { outcome: "created", relationship };
  }

  getInvitationPreview(viewerAccountId: string, at: Date): CompatibilityInvitationPreview | null {
    this.expirePending(at);
    const relationship = this.readRelationship();
    if (relationship?.status !== "pending") return null;
    return {
      id: relationship.id,
      inviterDisplayName: relationship.inviterDisplayName,
      offeredDiagnosisIds: relationship.offeredThemes.map(({ diagnosisId }) => diagnosisId),
      expiresAt: relationship.expiresAt,
      isOwnInvitation: relationship.inviterAccountId === viewerAccountId,
    };
  }

  getInvitationAcceptanceContext(at: Date): CompatibilityInvitationAcceptanceContext | null {
    this.expirePending(at);
    const relationship = this.readRelationship();
    if (relationship?.status !== "pending") return null;
    return {
      inviterAccountId: relationship.inviterAccountId,
      offeredDiagnosisIds: relationship.offeredThemes.map(({ diagnosisId }) => diagnosisId),
      expiresAt: relationship.expiresAt,
    };
  }

  acceptInvitation(
    input: AcceptCompatibilityInvitationInput,
    acceptedAt: Date,
  ): AcceptCompatibilityInvitationResult {
    assertNonEmpty(input.inviteeAccountId, "inviteeAccountId");
    assertNonEmpty(input.inviteeDisplayName, "inviteeDisplayName");
    assertThemes(input.acceptedThemes);
    this.expirePending(acceptedAt);
    const relationship = this.readRelationship();
    if (!relationship) return { outcome: "unavailable" };
    if (relationship.inviterAccountId === input.inviteeAccountId) {
      return { outcome: "self-invite" };
    }
    if (relationship.status === "expired") return { outcome: "expired" };
    if (relationship.status === "accepted") {
      if (
        relationship.inviteeAccountId === input.inviteeAccountId &&
        relationship.inviteeDisplayName === input.inviteeDisplayName.trim() &&
        relationship.acceptedThemes.every((theme) =>
          input.acceptedThemes.some(
            (candidate) =>
              candidate.diagnosisId === theme.diagnosisId &&
              candidate.resultFingerprint === theme.resultFingerprint,
          ),
        ) &&
        relationship.acceptedThemes.length === input.acceptedThemes.length
      ) {
        return { outcome: "unchanged", relationship };
      }
      return { outcome: "unavailable" };
    }
    if (relationship.status !== "pending") return { outcome: "unavailable" };

    const offeredDiagnosisIds = new Set(
      relationship.offeredThemes.map(({ diagnosisId }) => diagnosisId),
    );
    if (input.acceptedThemes.some(({ diagnosisId }) => !offeredDiagnosisIds.has(diagnosisId))) {
      return { outcome: "invalid-themes" };
    }

    this.db.transaction((tx) => {
      tx.insert(compatibilityAcceptedThemes)
        .values(
          input.acceptedThemes.map((theme) => ({
            relationshipId: relationship.id,
            diagnosisId: theme.diagnosisId,
            resultFingerprint: theme.resultFingerprint,
            consentedAt: acceptedAt,
          })),
        )
        .run();
      tx.update(compatibilityRelationships)
        .set({
          inviteeAccountId: input.inviteeAccountId,
          inviteeDisplayName: input.inviteeDisplayName.trim(),
          status: "accepted",
          acceptedAt,
          updatedAt: acceptedAt,
        })
        .where(eq(compatibilityRelationships.singleton, 1))
        .run();
    });

    const accepted = this.readRelationship();
    if (!accepted) throw new Error("Accepted compatibility relationship was not persisted");
    return { outcome: "accepted", relationship: accepted };
  }

  cancelInvitation(actorAccountId: string, at: Date): CancelCompatibilityInvitationResult {
    this.expirePending(at);
    const relationship = this.readRelationship();
    if (!relationship) return { outcome: "unavailable" };
    if (relationship.inviterAccountId !== actorAccountId) return { outcome: "forbidden" };
    if (relationship.status === "cancelled") {
      return { outcome: "unchanged", relationship };
    }
    if (relationship.status !== "pending") return { outcome: "unavailable" };
    this.db
      .update(compatibilityRelationships)
      .set({ status: "cancelled", cancelledAt: at, updatedAt: at })
      .where(eq(compatibilityRelationships.singleton, 1))
      .run();
    const cancelled = this.readRelationship();
    if (!cancelled) throw new Error("Cancelled compatibility invitation was not persisted");
    return { outcome: "cancelled", relationship: cancelled };
  }

  getRelationship(actorAccountId: string, at: Date): CompatibilityRelationship | null {
    this.expirePending(at);
    const relationship = this.readRelationship();
    if (
      !relationship ||
      relationship.status !== "accepted" ||
      (relationship.inviterAccountId !== actorAccountId &&
        relationship.inviteeAccountId !== actorAccountId)
    ) {
      return null;
    }
    return relationship;
  }

  endRelationship(actorAccountId: string, at: Date): EndCompatibilityRelationshipResult {
    const relationship = this.readRelationship();
    if (!relationship) return { outcome: "not-found" };
    const isParticipant =
      relationship.inviterAccountId === actorAccountId ||
      relationship.inviteeAccountId === actorAccountId;
    if (!isParticipant) return { outcome: "not-found" };
    if (relationship.status === "ended") return { outcome: "unchanged", relationship };
    if (relationship.status !== "accepted") return { outcome: "unavailable" };
    this.db
      .update(compatibilityRelationships)
      .set({ status: "ended", endedAt: at, endedByAccountId: actorAccountId, updatedAt: at })
      .where(eq(compatibilityRelationships.singleton, 1))
      .run();
    const ended = this.readRelationship();
    if (!ended) throw new Error("Ended compatibility relationship was not persisted");
    return { outcome: "ended", relationship: ended };
  }

  expirePending(at: Date): boolean {
    const relationship = this.db
      .select({
        status: compatibilityRelationships.status,
        expiresAt: compatibilityRelationships.expiresAt,
      })
      .from(compatibilityRelationships)
      .where(eq(compatibilityRelationships.singleton, 1))
      .get();
    if (
      !relationship ||
      relationship.status !== "pending" ||
      relationship.expiresAt.getTime() > at.getTime()
    ) {
      return false;
    }
    this.db
      .update(compatibilityRelationships)
      .set({ status: "expired", updatedAt: at })
      .where(eq(compatibilityRelationships.singleton, 1))
      .run();
    return true;
  }

  private readRelationship(): CompatibilityRelationship | null {
    const relationship = this.db
      .select()
      .from(compatibilityRelationships)
      .where(eq(compatibilityRelationships.singleton, 1))
      .get();
    if (!relationship) return null;
    const offeredThemes = this.db
      .select({
        diagnosisId: compatibilityOfferedThemes.diagnosisId,
        resultFingerprint: compatibilityOfferedThemes.resultFingerprint,
        consentedAt: compatibilityOfferedThemes.consentedAt,
      })
      .from(compatibilityOfferedThemes)
      .orderBy(asc(compatibilityOfferedThemes.diagnosisId))
      .all();
    const acceptedThemes = this.db
      .select({
        diagnosisId: compatibilityAcceptedThemes.diagnosisId,
        resultFingerprint: compatibilityAcceptedThemes.resultFingerprint,
        consentedAt: compatibilityAcceptedThemes.consentedAt,
      })
      .from(compatibilityAcceptedThemes)
      .orderBy(asc(compatibilityAcceptedThemes.diagnosisId))
      .all();
    return {
      id: relationship.relationshipId,
      inviterAccountId: relationship.inviterAccountId,
      inviteeAccountId: relationship.inviteeAccountId,
      inviterDisplayName: relationship.inviterDisplayName,
      inviteeDisplayName: relationship.inviteeDisplayName,
      status: relationship.status,
      offeredThemes,
      acceptedThemes,
      expiresAt: relationship.expiresAt,
      acceptedAt: relationship.acceptedAt,
      cancelledAt: relationship.cancelledAt,
      endedAt: relationship.endedAt,
      endedByAccountId: relationship.endedByAccountId,
      createdAt: relationship.createdAt,
      updatedAt: relationship.updatedAt,
    };
  }
}
