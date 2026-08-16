import {
  type AccountDataNamespace,
  type D1,
  type DO,
  accountDataFor,
  billing,
} from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type Params = Readonly<{
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
  planAssignmentProvider?: billing.AccountPlanAssignmentProvider;
  at?: Date;
}>;

export async function getProfileEntitlement({
  idToken,
  lineLoginChannelId,
  db,
  accountData,
  planAssignmentProvider,
  at = new Date(),
}: Params) {
  const session = await createLiffSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;
  if (!accountData) throw new Error("AccountData binding is missing");

  const entitlement = await new billing.EntitlementService(
    planAssignmentProvider ?? new billing.FamilySeatAccountPlanAssignmentProvider(db),
  ).resolve(session.session.accountId, at);
  const account = accountDataFor(accountData, session.session.accountId);
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
