import {
  type AcceptCompatibilityInvitationInput,
  type AcceptCompatibilityInvitationResult,
  COMPATIBILITY_INVITATION_TTL_MS,
  type CancelCompatibilityInvitationResult,
  type CompatibilityInvitationAcceptanceContext,
  type CompatibilityInvitationPreview,
  type CompatibilityRelationship,
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

function isCompatibilityInvitationExpired(
  relationship: CompatibilityRelationship,
  at: Date,
): boolean {
  assertValidDate(at, "at");
  assertValidDate(relationship.expiresAt, "expiresAt");
  return relationship.expiresAt.getTime() <= at.getTime();
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
  assertValidDate(createdAt, "createdAt");

  if (existing) {
    if (
      existing.id !== relationshipId ||
      existing.inviterAccountId !== input.inviterAccountId ||
      existing.inviterDisplayName !== input.inviterDisplayName.trim()
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
  if (relationship.status !== "pending" || !isCompatibilityInvitationExpired(relationship, at)) {
    return relationship;
  }
  return { ...relationship, status: "expired", updatedAt: at };
}

export function createCompatibilityInvitationPreview(
  relationship: CompatibilityRelationship | null,
  viewerAccountId: string,
  at: Date,
): CompatibilityInvitationPreview | null {
  assertNonEmpty(viewerAccountId, "viewerAccountId");
  assertValidDate(at, "at");
  if (relationship?.status !== "pending" || isCompatibilityInvitationExpired(relationship, at)) {
    return null;
  }
  return {
    id: relationship.id,
    inviterDisplayName: relationship.inviterDisplayName,
    expiresAt: relationship.expiresAt,
    isOwnInvitation: relationship.inviterAccountId === viewerAccountId,
  };
}

export function createCompatibilityInvitationAcceptanceContext(
  relationship: CompatibilityRelationship | null,
  at: Date,
): CompatibilityInvitationAcceptanceContext | null {
  assertValidDate(at, "at");
  if (relationship?.status !== "pending" || isCompatibilityInvitationExpired(relationship, at)) {
    return null;
  }
  return {
    inviterAccountId: relationship.inviterAccountId,
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
  assertValidDate(acceptedAt, "acceptedAt");
  if (!relationship) return { outcome: "unavailable" };
  if (
    relationship.status === "expired" ||
    (relationship.status === "pending" &&
      isCompatibilityInvitationExpired(relationship, acceptedAt))
  ) {
    return { outcome: "expired" };
  }
  if (relationship.inviterAccountId === input.inviteeAccountId) {
    return { outcome: "self-invite" };
  }
  if (relationship.status === "accepted") {
    if (
      relationship.inviteeAccountId === input.inviteeAccountId &&
      relationship.inviteeDisplayName === input.inviteeDisplayName.trim()
    ) {
      return { outcome: "unchanged", relationship };
    }
    return { outcome: "unavailable" };
  }
  if (relationship.status !== "pending") return { outcome: "unavailable" };

  return {
    outcome: "accepted",
    relationship: {
      ...relationship,
      inviteeAccountId: input.inviteeAccountId,
      inviteeDisplayName: input.inviteeDisplayName.trim(),
      status: "accepted",
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
  if (
    relationship.status === "expired" ||
    (relationship.status === "pending" && isCompatibilityInvitationExpired(relationship, at))
  ) {
    return { outcome: "unavailable" };
  }
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
