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

export type CompatibilityThemeFingerprint = Readonly<{
  diagnosisId: string;
  resultFingerprint: string;
}>;

export type CompatibilityThemeConsent = Readonly<{
  diagnosisId: string;
  resultFingerprint: string;
  consentedAt: Date;
}>;

export type CompatibilityProfileFingerprint = Readonly<{
  profileSummaryVersionId: string;
  fingerprint: string;
}>;

export type CompatibilityProfileConsent = CompatibilityProfileFingerprint &
  Readonly<{ consentedAt: Date }>;

export type CompatibilityRelationship = Readonly<{
  id: string;
  inviterAccountId: string;
  inviteeAccountId: string | null;
  inviterDisplayName: string;
  inviteeDisplayName: string | null;
  status: CompatibilityRelationshipStatus;
  /** 旧migrationで作られた未発行データはnull。新規招待では必ず保存する。 */
  offeredProfile: CompatibilityProfileConsent | null;
  acceptedProfile: CompatibilityProfileConsent | null;
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
  offeredProfile: CompatibilityProfileFingerprint;
  offeredThemes: readonly CompatibilityThemeFingerprint[];
}>;

export type AcceptCompatibilityInvitationInput = Readonly<{
  inviteeAccountId: string;
  inviteeDisplayName: string;
  acceptedProfile: CompatibilityProfileFingerprint;
  acceptedThemes: readonly CompatibilityThemeFingerprint[];
}>;

/** 招待確認画面へ渡せる、Account IDと同意指紋を含まない表示用データ。 */
export type CompatibilityInvitationPreview = Readonly<{
  id: string;
  inviterDisplayName: string;
  offeredDiagnosisIds: readonly string[];
  expiresAt: Date;
  isOwnInvitation: boolean;
}>;

/** 承諾の重複関係確認だけに使う、画面へ返さない内部context。 */
export type CompatibilityInvitationAcceptanceContext = Readonly<{
  inviterAccountId: string;
  offeredDiagnosisIds: readonly string[];
  expiresAt: Date;
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
      outcome: "self-invite" | "expired" | "unavailable" | "invalid-themes" | "unreserved";
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
  getInvitationPreview(
    relationshipId: string,
    viewerAccountId: string,
  ): Promise<CompatibilityInvitationPreview | null>;
  getInvitationAcceptanceContext(
    relationshipId: string,
  ): Promise<CompatibilityInvitationAcceptanceContext | null>;
  acceptInvitation(
    relationshipId: string,
    input: AcceptCompatibilityInvitationInput,
  ): Promise<AcceptCompatibilityInvitationResult>;
  cancelInvitation(
    relationshipId: string,
    actorAccountId: string,
  ): Promise<CancelCompatibilityInvitationResult>;
  getRelationship(
    relationshipId: string,
    actorAccountId: string,
  ): Promise<CompatibilityRelationship | null>;
  endRelationship(
    relationshipId: string,
    actorAccountId: string,
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
    getInvitationPreview(viewerAccountId: string) {
      return object.getInvitationPreview(relationshipId, viewerAccountId);
    },
    getInvitationAcceptanceContext() {
      return object.getInvitationAcceptanceContext(relationshipId);
    },
    acceptInvitation(input: AcceptCompatibilityInvitationInput) {
      return object.acceptInvitation(relationshipId, input);
    },
    cancelInvitation(actorAccountId: string) {
      return object.cancelInvitation(relationshipId, actorAccountId);
    },
    getRelationship(actorAccountId: string) {
      return object.getRelationship(relationshipId, actorAccountId);
    },
    endRelationship(actorAccountId: string) {
      return object.endRelationship(relationshipId, actorAccountId);
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

export type ReleaseCompatibilityReservationResult = Readonly<{
  outcome: "released" | "unchanged";
  reference: CompatibilityReference | null;
}>;

export type ActivateCompatibilityReferenceResult = Readonly<{
  outcome: "activated" | "unchanged" | "conflict";
  reference: CompatibilityReference;
}>;
