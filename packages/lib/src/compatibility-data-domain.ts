import {
  type AcceptCompatibilityInvitationInput,
  type AcceptCompatibilityInvitationResult,
  COMPATIBILITY_INVITATION_TTL_MS,
  type CancelCompatibilityInvitationResult,
  type CompatibilityInvitationAcceptanceContext,
  type CompatibilityInvitationPreview,
  type CompatibilityRelationship,
  type CompatibilityThemeConsent,
  type CompatibilityThemeFingerprint,
  type CreateCompatibilityInvitationInput,
  type CreateCompatibilityInvitationResult,
  type EndCompatibilityRelationshipResult,
} from "./compatibility-data";

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`${field} is required`);
}

function assertValidDate(value: Date, field: string): void {
  if (!Number.isFinite(value.getTime())) throw new Error(`${field} must be a valid date`);
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
  return right.every(
    (theme) => byDiagnosis.get(theme.diagnosisId)?.resultFingerprint === theme.resultFingerprint,
  );
}

/** 新規招待または同じcommandの再試行を、永続化技術に依存せず判定する。 */
export function decideCompatibilityInvitationCreation(
  existing: CompatibilityRelationship | null,
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
  assertValidDate(createdAt, "createdAt");

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

  const relationship: CompatibilityRelationship = {
    id: relationshipId,
    inviterAccountId: input.inviterAccountId,
    inviteeAccountId: null,
    inviterDisplayName: input.inviterDisplayName.trim(),
    inviteeDisplayName: null,
    status: "pending",
    offeredThemes: input.offeredThemes.map((theme) => ({ ...theme, consentedAt: createdAt })),
    acceptedThemes: [],
    expiresAt: new Date(createdAt.getTime() + COMPATIBILITY_INVITATION_TTL_MS),
    acceptedAt: null,
    cancelledAt: null,
    endedAt: null,
    endedByAccountId: null,
    createdAt,
    updatedAt: createdAt,
  };
  return { outcome: "created", relationship };
}

/** pendingの期限到来だけを終端化し、変更がなければ同じ参照を返す。 */
export function expireCompatibilityRelationship(
  relationship: CompatibilityRelationship,
  at: Date,
): CompatibilityRelationship {
  assertValidDate(at, "at");
  if (relationship.status !== "pending" || relationship.expiresAt.getTime() > at.getTime()) {
    return relationship;
  }
  return { ...relationship, status: "expired", updatedAt: at };
}

export function createCompatibilityInvitationPreview(
  relationship: CompatibilityRelationship | null,
  viewerAccountId: string,
): CompatibilityInvitationPreview | null {
  assertNonEmpty(viewerAccountId, "viewerAccountId");
  if (relationship?.status !== "pending") return null;
  return {
    id: relationship.id,
    inviterDisplayName: relationship.inviterDisplayName,
    offeredDiagnosisIds: relationship.offeredThemes.map(({ diagnosisId }) => diagnosisId),
    expiresAt: relationship.expiresAt,
    isOwnInvitation: relationship.inviterAccountId === viewerAccountId,
  };
}

export function createCompatibilityInvitationAcceptanceContext(
  relationship: CompatibilityRelationship | null,
): CompatibilityInvitationAcceptanceContext | null {
  if (relationship?.status !== "pending") return null;
  return {
    inviterAccountId: relationship.inviterAccountId,
    offeredDiagnosisIds: relationship.offeredThemes.map(({ diagnosisId }) => diagnosisId),
    expiresAt: relationship.expiresAt,
  };
}

/** 承諾commandの状態遷移を判定し、保存すべきaccepted集約を返す。 */
export function decideCompatibilityInvitationAcceptance(
  relationship: CompatibilityRelationship | null,
  input: AcceptCompatibilityInvitationInput,
  acceptedAt: Date,
): AcceptCompatibilityInvitationResult {
  assertNonEmpty(input.inviteeAccountId, "inviteeAccountId");
  assertNonEmpty(input.inviteeDisplayName, "inviteeDisplayName");
  assertThemes(input.acceptedThemes);
  assertValidDate(acceptedAt, "acceptedAt");
  if (!relationship) return { outcome: "unavailable" };
  if (relationship.inviterAccountId === input.inviteeAccountId) {
    return { outcome: "self-invite" };
  }
  if (relationship.status === "expired") return { outcome: "expired" };
  if (relationship.status === "accepted") {
    if (
      relationship.inviteeAccountId === input.inviteeAccountId &&
      relationship.inviteeDisplayName === input.inviteeDisplayName.trim() &&
      sameThemes(relationship.acceptedThemes, input.acceptedThemes)
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

  return {
    outcome: "accepted",
    relationship: {
      ...relationship,
      inviteeAccountId: input.inviteeAccountId,
      inviteeDisplayName: input.inviteeDisplayName.trim(),
      status: "accepted",
      acceptedThemes: input.acceptedThemes.map((theme) => ({
        ...theme,
        consentedAt: acceptedAt,
      })),
      acceptedAt,
      updatedAt: acceptedAt,
    },
  };
}

export function decideCompatibilityInvitationCancellation(
  relationship: CompatibilityRelationship | null,
  actorAccountId: string,
  at: Date,
): CancelCompatibilityInvitationResult {
  assertNonEmpty(actorAccountId, "actorAccountId");
  assertValidDate(at, "at");
  if (!relationship) return { outcome: "unavailable" };
  if (relationship.inviterAccountId !== actorAccountId) return { outcome: "forbidden" };
  if (relationship.status === "cancelled") return { outcome: "unchanged", relationship };
  if (relationship.status !== "pending") return { outcome: "unavailable" };
  return {
    outcome: "cancelled",
    relationship: { ...relationship, status: "cancelled", cancelledAt: at, updatedAt: at },
  };
}

export function getAcceptedCompatibilityRelationship(
  relationship: CompatibilityRelationship | null,
  actorAccountId: string,
): CompatibilityRelationship | null {
  assertNonEmpty(actorAccountId, "actorAccountId");
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

export function decideCompatibilityRelationshipEnd(
  relationship: CompatibilityRelationship | null,
  actorAccountId: string,
  at: Date,
): EndCompatibilityRelationshipResult {
  assertNonEmpty(actorAccountId, "actorAccountId");
  assertValidDate(at, "at");
  if (!relationship) return { outcome: "not-found" };
  const isParticipant =
    relationship.inviterAccountId === actorAccountId ||
    relationship.inviteeAccountId === actorAccountId;
  if (!isParticipant) return { outcome: "not-found" };
  if (relationship.status === "ended") return { outcome: "unchanged", relationship };
  if (relationship.status !== "accepted") return { outcome: "unavailable" };
  return {
    outcome: "ended",
    relationship: {
      ...relationship,
      status: "ended",
      endedAt: at,
      endedByAccountId: actorAccountId,
      updatedAt: at,
    },
  };
}
