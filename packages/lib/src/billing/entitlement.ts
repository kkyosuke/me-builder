import { AI_REPLY_MONTHLY_LIMITS, PROFILE_SUMMARY_MONTHLY_LIMIT } from "@me-builder/shared";
import {
  type AccountPlanAssignment,
  type AccountPlanAssignmentProvider,
  type PlanAssignmentSource,
  type PlanCode,
  freePlanAssignment,
  planAssignmentSources,
  planCodes,
} from "./account-plan-assignment";

export { AI_REPLY_MONTHLY_LIMITS, PROFILE_SUMMARY_MONTHLY_LIMIT } from "@me-builder/shared";

export const entitlementFeatures = [
  "weekly-reflection",
  "monthly-change",
  "goal-follow-up",
  "personalized-self-care",
  "relationship-reflection",
] as const;
export type EntitlementFeature = (typeof entitlementFeatures)[number];

export type EntitlementPolicy = Readonly<{
  aiReply: Readonly<{ limit: number; period: "assignment-month" }>;
  profileSummary: Readonly<{
    limit: number;
    period: "assignment-month";
  }>;
  semanticSearchDays: number | null;
  relationshipQuestionContext: "current-message" | "session-and-diagnosis" | "confirmed-history";
  monthlyChange: "none" | "brief" | "full";
  goalFollowUp: "none" | "selected-one" | "relevant-active";
  selfCareContext: "general" | "confirmed" | "personalized-history";
  concurrentRelationshipLimit: number;
  familySeatLimit: number;
  features: Readonly<Record<EntitlementFeature, boolean>>;
}>;

const policies = {
  free: {
    aiReply: { limit: AI_REPLY_MONTHLY_LIMITS.free, period: "assignment-month" },
    profileSummary: { limit: PROFILE_SUMMARY_MONTHLY_LIMIT, period: "assignment-month" },
    semanticSearchDays: 30,
    relationshipQuestionContext: "current-message",
    monthlyChange: "none",
    goalFollowUp: "none",
    selfCareContext: "general",
    concurrentRelationshipLimit: 0,
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
    aiReply: { limit: AI_REPLY_MONTHLY_LIMITS.lite, period: "assignment-month" },
    profileSummary: { limit: PROFILE_SUMMARY_MONTHLY_LIMIT, period: "assignment-month" },
    semanticSearchDays: 365,
    relationshipQuestionContext: "session-and-diagnosis",
    monthlyChange: "brief",
    goalFollowUp: "selected-one",
    selfCareContext: "confirmed",
    concurrentRelationshipLimit: 1,
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
    aiReply: { limit: AI_REPLY_MONTHLY_LIMITS.full, period: "assignment-month" },
    profileSummary: { limit: PROFILE_SUMMARY_MONTHLY_LIMIT, period: "assignment-month" },
    semanticSearchDays: null,
    relationshipQuestionContext: "confirmed-history",
    monthlyChange: "full",
    goalFollowUp: "relevant-active",
    selfCareContext: "personalized-history",
    concurrentRelationshipLimit: 5,
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
    aiReply: { limit: AI_REPLY_MONTHLY_LIMITS.family, period: "assignment-month" },
    profileSummary: { limit: PROFILE_SUMMARY_MONTHLY_LIMIT, period: "assignment-month" },
    semanticSearchDays: null,
    relationshipQuestionContext: "confirmed-history",
    monthlyChange: "full",
    goalFollowUp: "relevant-active",
    selfCareContext: "personalized-history",
    concurrentRelationshipLimit: 5,
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

export const entitlementFallbackReasons = [
  "provider-unavailable",
  "invalid-assignment",
  "not-yet-effective",
  "expired",
] as const;
export type EntitlementFallbackReason = (typeof entitlementFallbackReasons)[number];

export type ResolvedEntitlement = Readonly<{
  accountId: string;
  plan: PlanCode;
  source: PlanAssignmentSource;
  effectiveAt: string;
  availableUntil: string | null;
  payerAccountId: string | null;
  grantedByFamily: boolean;
  policy: EntitlementPolicy;
  resolution: "assignment" | "safe-default";
  fallbackReason: EntitlementFallbackReason | null;
  resolvedAt: string;
}>;

/** Provider障害や不正なprojectionを有料権限へ倒さない、機能側の唯一のPlan解決境界。 */
export class EntitlementService {
  constructor(private readonly assignmentProvider: AccountPlanAssignmentProvider) {}

  async resolve(accountId: string, at = new Date()): Promise<ResolvedEntitlement> {
    try {
      const assignment = await this.assignmentProvider.findCurrent(accountId, at);
      const invalidReason = validateAssignment(assignment, accountId, at);
      if (invalidReason !== null) return safeDefault(accountId, at, invalidReason);
      return resolved(assignment, at, "assignment", null);
    } catch {
      return safeDefault(accountId, at, "provider-unavailable");
    }
  }
}

function validateAssignment(
  assignment: AccountPlanAssignment,
  accountId: string,
  at: Date,
): EntitlementFallbackReason | null {
  if (
    assignment.accountId !== accountId ||
    !isPlanCode(assignment.plan) ||
    !isAssignmentSource(assignment.source)
  ) {
    return "invalid-assignment";
  }

  const effectiveAt = Date.parse(assignment.effectiveAt);
  const availableUntil =
    assignment.availableUntil === null ? null : Date.parse(assignment.availableUntil);
  if (
    !Number.isFinite(effectiveAt) ||
    (availableUntil !== null && !Number.isFinite(availableUntil))
  ) {
    return "invalid-assignment";
  }
  if (effectiveAt > at.getTime()) return "not-yet-effective";
  if (availableUntil !== null && availableUntil <= at.getTime()) return "expired";

  if (assignment.source === "family-seat") {
    if (
      assignment.plan !== "family" ||
      assignment.payerAccountId === null ||
      assignment.payerAccountId === accountId
    ) {
      return "invalid-assignment";
    }
  }
  if (assignment.plan !== "free" && assignment.source === "free") {
    return "invalid-assignment";
  }
  if (
    assignment.plan === "free" &&
    (assignment.source !== "free" || assignment.payerAccountId !== null)
  ) {
    return "invalid-assignment";
  }
  return null;
}

function safeDefault(
  accountId: string,
  at: Date,
  reason: EntitlementFallbackReason,
): ResolvedEntitlement {
  return resolved(freePlanAssignment(accountId, at), at, "safe-default", reason);
}

function resolved(
  assignment: AccountPlanAssignment,
  at: Date,
  resolution: ResolvedEntitlement["resolution"],
  fallbackReason: EntitlementFallbackReason | null,
): ResolvedEntitlement {
  return Object.freeze({
    ...assignment,
    grantedByFamily: assignment.source === "family-seat",
    policy: policies[assignment.plan],
    resolution,
    fallbackReason,
    resolvedAt: at.toISOString(),
  });
}

function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && (planCodes as readonly string[]).includes(value);
}

function isAssignmentSource(value: unknown): value is PlanAssignmentSource {
  return typeof value === "string" && (planAssignmentSources as readonly string[]).includes(value);
}
