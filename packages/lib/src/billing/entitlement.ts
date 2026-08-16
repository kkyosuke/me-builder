import {
  type AccountPlanAssignment,
  type AccountPlanAssignmentProvider,
  type PlanAssignmentSource,
  type PlanCode,
  freePlanAssignment,
  planAssignmentSources,
  planCodes,
} from "./account-plan-assignment";
import { resolvePlanCapabilityValues } from "./plan-capability";

export const entitlementFeatures = [
  "diary-storage",
  "diagnosis-basic-results",
  "weekly-reflection",
  "monthly-change",
  "goal-follow-up",
  "personalized-self-care",
  "basic-compatibility-sheet",
  "relationship-reflection",
] as const;
export type EntitlementFeature = (typeof entitlementFeatures)[number];

export type EntitlementPolicy = Readonly<{
  aiReply: Readonly<{ limit: number; period: "assignment-month" }>;
  profileSummary: Readonly<{
    limit: number;
    period: "assignment-month" | "rolling-90-days";
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

const policies = Object.freeze(
  Object.fromEntries(planCodes.map((plan) => [plan, policyFor(plan)])) as Record<
    PlanCode,
    EntitlementPolicy
  >,
);

function policyFor(plan: PlanCode): EntitlementPolicy {
  const values = resolvePlanCapabilityValues(plan);
  return Object.freeze({
    aiReply: values.aiReply,
    profileSummary: values.profileSummary,
    semanticSearchDays: values.semanticSearchDays,
    relationshipQuestionContext: values.relationshipQuestionContext,
    monthlyChange: values.monthlyChange,
    goalFollowUp: values.goalFollowUp,
    selfCareContext: values.selfCareContext,
    concurrentRelationshipLimit: values.concurrentRelationshipLimit,
    familySeatLimit: plan === "family" ? values.accountSeatLimit : 0,
    features: Object.freeze({
      "diary-storage": values.diaryStorage,
      "diagnosis-basic-results": values.diagnosisBasicResults,
      "weekly-reflection": values.weeklyReflection,
      "monthly-change": values.monthlyChange !== "none",
      "goal-follow-up": values.goalFollowUp !== "none",
      "personalized-self-care": values.selfCareContext !== "general",
      "basic-compatibility-sheet": values.basicCompatibilitySheet,
      "relationship-reflection": values.concurrentRelationshipLimit > 0,
    }),
  });
}

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
