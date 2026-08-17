import {
  type AccountDataNamespace,
  type D1,
  type DO,
  accountDataFor,
  billing,
} from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type Params = Readonly<{
  actor: AuthenticatedActor;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
  planAssignmentProvider?: billing.AccountPlanAssignmentProvider;
  at?: Date;
}>;

export async function getProfileEntitlement({
  actor,
  db,
  accountData,
  planAssignmentProvider,
  at = new Date(),
}: Params) {
  if (!accountData) throw new Error("AccountData binding is missing");

  const entitlement = await new billing.EntitlementService(
    new billing.FamilyAwareAccountPlanAssignmentProvider(db, planAssignmentProvider),
  ).resolve(actor.accountId, at);
  const account = accountDataFor(accountData, actor.accountId);
  const aiReplyPeriod = billing.resolveEntitlementUsagePeriod(entitlement, "ai-reply", at);
  const profileSummaryPeriod = billing.resolveEntitlementUsagePeriod(
    entitlement,
    "profile-summary",
    at,
  );
  const [aiReply, profileSummary] = await Promise.all([
    account.execute(
      "aiUsage.read",
      "ai-reply",
      aiReplyPeriod,
      entitlement.policy.aiReply.limit,
      at,
    ),
    account.execute(
      "aiUsage.read",
      "profile-summary",
      profileSummaryPeriod,
      entitlement.policy.profileSummary.limit,
      at,
    ),
  ]);
  return {
    type: "resolved" as const,
    status:
      entitlement.resolution === "safe-default"
        ? ("safe-default" as const)
        : entitlement.plan === "free"
          ? ("free" as const)
          : ("active" as const),
    plan: entitlement.plan,
    source: entitlement.source,
    effectiveAt: entitlement.effectiveAt,
    availableUntil: entitlement.availableUntil,
    aiReply: usageResponse(aiReply),
    profileSummary: usageResponse(profileSummary),
  };
}

function usageResponse(usage: Awaited<ReturnType<typeof DO.account.action.aiUsage.readAiUsage>>) {
  return {
    limit: usage.limit,
    used: usage.committed,
    reserved: usage.reserved,
    remaining: usage.remaining,
    periodStartsAt: usage.period.start.toISOString(),
    resetsAt: usage.period.end.toISOString(),
  };
}
