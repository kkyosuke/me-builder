import { type AccountDataNamespace, type D1, accountDataFor, billing } from "@me-builder/lib";
import type { SelfCareConfirmationKind } from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type Common = Readonly<{
  actor: AuthenticatedActor;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
  at?: Date;
  planAssignmentProvider?: billing.AccountPlanAssignmentProvider;
}>;

async function resolve(params: Common) {
  const entitlement = await new billing.EntitlementService(
    new billing.FamilyAwareAccountPlanAssignmentProvider(params.db, params.planAssignmentProvider),
  ).resolve(params.actor.accountId, params.at);
  return {
    type: "resolved" as const,
    entitlement,
    account: accountDataFor(params.accountData, params.actor.accountId),
  };
}

export async function getSelfCareContexts(params: Common) {
  const context = await resolve(params);
  return {
    type: "resolved" as const,
    ...(await context.account.execute("selfCareContext.read")),
    canManage: context.entitlement.policy.features["personalized-self-care"],
  };
}

export async function confirmSelfCareContext(
  params: Common & Readonly<{ brainItemId: string; kind: SelfCareConfirmationKind }>,
) {
  const context = await resolve(params);
  if (!context.entitlement.policy.features["personalized-self-care"]) {
    return { type: "unavailable" as const, reason: "feature_unavailable" as const };
  }
  const result = await context.account.execute(
    "selfCareContext.confirm",
    params.brainItemId,
    params.kind,
    params.at,
  );
  return { type: "resolved" as const, result };
}

export async function revokeSelfCareContext(params: Common & Readonly<{ id: string }>) {
  const context = await resolve(params);
  if (!context.entitlement.policy.features["personalized-self-care"]) {
    return { type: "unavailable" as const, reason: "feature_unavailable" as const };
  }
  const result = await context.account.execute("selfCareContext.revoke", params.id, params.at);
  return { type: "resolved" as const, result };
}
