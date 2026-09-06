import { AI_REPLY_MONTHLY_LIMITS } from "@me-builder/shared";
import type { PlanCode } from "./account-plan-assignment";

export const entitlementFeatures = [
  "weekly-reflection",
  "monthly-change",
  "goal-follow-up",
  "personalized-self-care",
  "relationship-reflection",
] as const;
export type EntitlementFeature = (typeof entitlementFeatures)[number];

export type EntitlementPolicy = Readonly<{
  accountRecovery: boolean;
  photoStorageLimitBytes: number;
  familyPackWithoutSubscription: boolean;
  aiReply: Readonly<{ limit: number; period: "assignment-month" }>;
  semanticSearchDays: number | null;
  relationshipQuestionContext: "current-message" | "session-and-diagnosis" | "confirmed-history";
  monthlyChange: "none" | "brief" | "full";
  goalFollowUp: "none" | "selected-one" | "relevant-active";
  selfCareContext: "general" | "confirmed" | "personalized-history";
  /** 同じfamily pack内を除く、同時に振り返りを割り当てられる外部関係数。 */
  concurrentRelationshipLimit: number;
  /** 双方のpayerAccountIdが一致するfamily参加者間を、外部関係枠を消費せず利用対象に含める。 */
  familyPackInternalRelationshipsIncluded: boolean;
  /** 支払者が管理できるactiveなfamily席数。 */
  familySeatLimit: number;
  features: Readonly<Record<EntitlementFeature, boolean>>;
}>;

const standardEntitlementPolicies = {
  free: {
    accountRecovery: false,
    photoStorageLimitBytes: 500 * 1024 * 1024,
    familyPackWithoutSubscription: false,
    aiReply: { limit: AI_REPLY_MONTHLY_LIMITS.free, period: "assignment-month" },
    semanticSearchDays: 30,
    relationshipQuestionContext: "current-message",
    monthlyChange: "none",
    goalFollowUp: "none",
    selfCareContext: "general",
    concurrentRelationshipLimit: 0,
    familyPackInternalRelationshipsIncluded: false,
    familySeatLimit: 0,
    features: {
      "weekly-reflection": false,
      "monthly-change": false,
      "goal-follow-up": false,
      "personalized-self-care": false,
      "relationship-reflection": false,
    },
  },
  lite: {
    accountRecovery: true,
    photoStorageLimitBytes: 5 * 1024 * 1024 * 1024,
    familyPackWithoutSubscription: false,
    aiReply: { limit: AI_REPLY_MONTHLY_LIMITS.lite, period: "assignment-month" },
    semanticSearchDays: 365,
    relationshipQuestionContext: "session-and-diagnosis",
    monthlyChange: "brief",
    goalFollowUp: "selected-one",
    selfCareContext: "confirmed",
    concurrentRelationshipLimit: 1,
    familyPackInternalRelationshipsIncluded: false,
    familySeatLimit: 0,
    features: {
      "weekly-reflection": true,
      "monthly-change": true,
      "goal-follow-up": true,
      "personalized-self-care": true,
      "relationship-reflection": true,
    },
  },
  full: {
    accountRecovery: true,
    photoStorageLimitBytes: 20 * 1024 * 1024 * 1024,
    familyPackWithoutSubscription: false,
    aiReply: { limit: AI_REPLY_MONTHLY_LIMITS.full, period: "assignment-month" },
    semanticSearchDays: null,
    relationshipQuestionContext: "confirmed-history",
    monthlyChange: "full",
    goalFollowUp: "relevant-active",
    selfCareContext: "personalized-history",
    concurrentRelationshipLimit: 5,
    familyPackInternalRelationshipsIncluded: false,
    familySeatLimit: 0,
    features: {
      "weekly-reflection": true,
      "monthly-change": true,
      "goal-follow-up": true,
      "personalized-self-care": true,
      "relationship-reflection": true,
    },
  },
  family: {
    accountRecovery: true,
    photoStorageLimitBytes: 20 * 1024 * 1024 * 1024,
    familyPackWithoutSubscription: false,
    aiReply: { limit: AI_REPLY_MONTHLY_LIMITS.family, period: "assignment-month" },
    semanticSearchDays: null,
    relationshipQuestionContext: "confirmed-history",
    monthlyChange: "full",
    goalFollowUp: "relevant-active",
    selfCareContext: "personalized-history",
    concurrentRelationshipLimit: 5,
    familyPackInternalRelationshipsIncluded: true,
    familySeatLimit: 4,
    features: {
      "weekly-reflection": true,
      "monthly-change": true,
      "goal-follow-up": true,
      "personalized-self-care": true,
      "relationship-reflection": true,
    },
  },
} as const satisfies Readonly<Record<PlanCode, EntitlementPolicy>>;

export type EntitlementCatalog = "standard" | "development";

const developmentPolicy: EntitlementPolicy = {
  ...standardEntitlementPolicies.family,
  familyPackWithoutSubscription: true,
};

const catalogs: Readonly<
  Record<EntitlementCatalog, Readonly<Record<PlanCode, EntitlementPolicy>>>
> = {
  standard: standardEntitlementPolicies,
  development: {
    free: developmentPolicy,
    lite: developmentPolicy,
    full: developmentPolicy,
    family: developmentPolicy,
  },
};

export function entitlementPolicy(
  plan: PlanCode,
  catalog: EntitlementCatalog = "standard",
): EntitlementPolicy {
  return catalogs[catalog][plan];
}

/** 環境の明示的なallowlist以外には開発用権限を適用しない。 */
export function entitlementCatalogForEnvironment(
  environment: string | undefined,
  configured?: string,
): EntitlementCatalog {
  const development = ["local", "development", "dev", "preview"].includes(
    environment?.trim() ?? "",
  );
  if (configured !== undefined) {
    const catalog = configured.trim();
    if (catalog === "standard") return catalog;
    if (catalog === "development" && development) return catalog;
    throw new Error("Invalid ENTITLEMENT_CATALOG for environment");
  }
  return development ? "development" : "standard";
}
