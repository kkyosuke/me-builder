export type CompatibilityRelationshipStatus =
  | "pending"
  | "accepted"
  | "cancelled"
  | "expired"
  | "ended";

export const COMPATIBILITY_INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** URLへ埋め込める、Account情報を含まない256 bitの関係IDを発行する。 */
export function createCompatibilityRelationshipId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export type CompatibilityThemeConsent = Readonly<{
  diagnosisId: string;
  resultFingerprint: string;
  consentedAt: Date;
}>;

export type CompatibilityRelationship = Readonly<{
  id: string;
  inviterAccountId: string;
  inviteeAccountId: string | null;
  inviterDisplayName: string;
  inviteeDisplayName: string | null;
  status: CompatibilityRelationshipStatus;
  offeredThemes: readonly CompatibilityThemeConsent[];
  acceptedThemes: readonly CompatibilityThemeConsent[];
  expiresAt: Date;
  acceptedAt: Date | null;
  cancelledAt: Date | null;
  endedAt: Date | null;
  endedByAccountId: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateCompatibilityInvitationInput = Readonly<{
  inviterAccountId: string;
  inviterDisplayName: string;
  offeredThemes: readonly CompatibilityThemeConsent[];
  expiresAt: Date;
  createdAt: Date;
}>;

export type AcceptCompatibilityInvitationInput = Readonly<{
  inviteeAccountId: string;
  inviteeDisplayName: string;
  acceptedThemes: readonly CompatibilityThemeConsent[];
  acceptedAt: Date;
}>;

export type CreateCompatibilityInvitationResult = Readonly<{
  outcome: "created" | "unchanged";
  relationship: CompatibilityRelationship;
}>;

export type AcceptCompatibilityInvitationResult =
  | Readonly<{
      outcome: "accepted" | "unchanged";
      relationship: CompatibilityRelationship;
    }>
  | Readonly<{
      outcome: "self-invite" | "expired" | "unavailable" | "invalid-themes";
    }>;

export type CancelCompatibilityInvitationResult =
  | Readonly<{
      outcome: "cancelled" | "unchanged";
      relationship: CompatibilityRelationship;
    }>
  | Readonly<{ outcome: "forbidden" | "unavailable" }>;

export type EndCompatibilityRelationshipResult =
  | Readonly<{
      outcome: "ended" | "unchanged";
      relationship: CompatibilityRelationship;
    }>
  | Readonly<{ outcome: "not-found" | "unavailable" }>;

/** raw SQLiteを公開しない、1相性関係の永続化RPC境界。 */
export interface CompatibilityDataRpc {
  createInvitation(
    relationshipId: string,
    input: CreateCompatibilityInvitationInput,
  ): Promise<CreateCompatibilityInvitationResult>;
  getInvitation(
    relationshipId: string,
    viewerAccountId: string,
    at: Date,
  ): Promise<CompatibilityRelationship | null>;
  acceptInvitation(
    relationshipId: string,
    input: AcceptCompatibilityInvitationInput,
  ): Promise<AcceptCompatibilityInvitationResult>;
  cancelInvitation(
    relationshipId: string,
    actorAccountId: string,
    at: Date,
  ): Promise<CancelCompatibilityInvitationResult>;
  getRelationship(
    relationshipId: string,
    actorAccountId: string,
    at: Date,
  ): Promise<CompatibilityRelationship | null>;
  endRelationship(
    relationshipId: string,
    actorAccountId: string,
    at: Date,
  ): Promise<EndCompatibilityRelationshipResult>;
}

export interface CompatibilityDataNamespace {
  getByName(name: string): CompatibilityDataRpc;
}

export function compatibilityDataFor(
  namespace: CompatibilityDataNamespace,
  relationshipId: string,
) {
  const object = namespace.getByName(relationshipId);
  return {
    createInvitation(input: CreateCompatibilityInvitationInput) {
      return object.createInvitation(relationshipId, input);
    },
    getInvitation(viewerAccountId: string, at: Date) {
      return object.getInvitation(relationshipId, viewerAccountId, at);
    },
    acceptInvitation(input: AcceptCompatibilityInvitationInput) {
      return object.acceptInvitation(relationshipId, input);
    },
    cancelInvitation(actorAccountId: string, at: Date) {
      return object.cancelInvitation(relationshipId, actorAccountId, at);
    },
    getRelationship(actorAccountId: string, at: Date) {
      return object.getRelationship(relationshipId, actorAccountId, at);
    },
    endRelationship(actorAccountId: string, at: Date) {
      return object.endRelationship(relationshipId, actorAccountId, at);
    },
  };
}

export type CompatibilityReferenceRole = "inviter" | "invitee";
export type CompatibilityReferenceStatus = "pending" | "reserved" | "active" | "ended";

export type CompatibilityReference = Readonly<{
  relationshipId: string;
  accountId: string;
  role: CompatibilityReferenceRole;
  partnerAccountId: string | null;
  status: CompatibilityReferenceStatus;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ReserveCompatibilityReferenceResult = Readonly<{
  outcome: "reserved" | "unchanged" | "conflict";
  reference: CompatibilityReference;
}>;

export type ActivateCompatibilityReferenceResult = Readonly<{
  outcome: "activated" | "unchanged" | "conflict";
  reference: CompatibilityReference;
}>;
