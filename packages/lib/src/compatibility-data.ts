import * as v from "valibot";
import type { RelationshipCategory } from "./diagnosis/relationship-category";

const COMPATIBILITY_RELATIONSHIP_ID_PATTERN = /^[a-f0-9]{64}$/;
const CompatibilityRelationshipIdSchema = v.pipe(
  v.string(),
  v.regex(COMPATIBILITY_RELATIONSHIP_ID_PATTERN),
);

/** relationship ID の生成元が所有する、公開範囲を絞った検証境界。 */
export const compatibilityRelationshipId = {
  schema: CompatibilityRelationshipIdSchema,
  isValid(value: unknown): value is string {
    return v.safeParse(CompatibilityRelationshipIdSchema, value).success;
  },
} as const;

export type CompatibilityRelationshipStatus =
  | "pending"
  | "accepted"
  | "cancelled"
  | "expired"
  | "ended";

/** 特定の相手を表す、相性共有で選択可能な関係カテゴリ。 */
export const compatibilityRelationshipCategoryValues = [
  "partner",
  "family",
  "friend",
  "work",
] as const satisfies readonly RelationshipCategory[];

export type CompatibilityRelationshipCategory =
  (typeof compatibilityRelationshipCategoryValues)[number];

export function isCompatibilityRelationshipCategory(
  value: unknown,
): value is CompatibilityRelationshipCategory {
  return compatibilityRelationshipCategoryValues.some((category) => category === value);
}

export const COMPATIBILITY_INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** URLへ埋め込める、Account情報を含まない256 bitの関係IDを発行する。 */
export function createCompatibilityRelationshipId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * 相性関係は、表示内容ではなく相手そのものへの継続的な共有同意を持つ。
 * 送信者の同意時刻は`createdAt`、受信者の同意時刻は`acceptedAt`が表す。
 */
export type CompatibilityRelationship = Readonly<{
  id: string;
  inviterAccountId: string;
  inviteeAccountId: string | null;
  inviterDisplayName: string;
  inviteeDisplayName: string | null;
  relationshipCategory: CompatibilityRelationshipCategory;
  status: CompatibilityRelationshipStatus;
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
  relationshipCategory: CompatibilityRelationshipCategory;
}>;

export type AcceptCompatibilityInvitationInput = Readonly<{
  inviteeAccountId: string;
  inviteeDisplayName: string;
}>;

/** 招待確認画面へ渡せる、Account IDを含まない表示用データ。 */
export type CompatibilityInvitationPreview = Readonly<{
  id: string;
  inviterDisplayName: string;
  relationshipCategory: CompatibilityRelationshipCategory;
  expiresAt: Date;
  isOwnInvitation: boolean;
}>;

/** 承諾時の重複確認に使う、画面へ返さない内部context。 */
export type CompatibilityInvitationAcceptanceContext = Readonly<{
  inviterAccountId: string;
  relationshipCategory: CompatibilityRelationshipCategory;
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
      outcome: "self-invite" | "expired" | "unavailable" | "unreserved";
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

export type CompatibilityPairThemeFingerprint = Readonly<{
  diagnosisId: string;
  fingerprint: string;
}>;

export type CompatibilityPairProgression = Readonly<{
  level: number;
  growthValue: number;
  currentLevelThreshold: number;
  nextLevelThreshold: number;
  comparableThemeCount: number;
  marks: readonly number[];
}>;

export function compatibilityPairProgressionThreshold(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1)
    throw new Error("Pair progression level must be a positive integer");
  return 3 * (level - 1) ** 2;
}

export function compatibilityPairProgressionLevel(growthValue: number): number {
  if (!Number.isSafeInteger(growthValue) || growthValue < 0)
    throw new Error("Pair progression growth must be a non-negative safe integer");
  return Math.floor(Math.sqrt(growthValue / 3)) + 1;
}

export function compatibilityPairProgressionMarks(level: number): number[] {
  const marks = [2, 5];
  for (let milestone = 10; milestone <= level; milestone += 10) marks.push(milestone);
  return marks.filter((milestone) => milestone <= level);
}

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
  synchronizeProgression(
    relationshipId: string,
    actorAccountId: string,
    themes: readonly CompatibilityPairThemeFingerprint[],
  ): Promise<CompatibilityPairProgression | null>;
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
    synchronizeProgression(
      actorAccountId: string,
      themes: readonly CompatibilityPairThemeFingerprint[],
    ) {
      return object.synchronizeProgression(relationshipId, actorAccountId, themes);
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
