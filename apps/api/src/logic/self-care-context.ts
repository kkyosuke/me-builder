import { type AccountDataNamespace, type D1, accountDataFor, billing } from "@me-builder/lib";
import type { SelfCareConfirmationKind } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type Common = Readonly<{
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
  at?: Date;
  planAssignmentProvider?: billing.AccountPlanAssignmentProvider;
}>;

async function resolve(params: Common) {
  const session = await createLiffSession(params);
  if (session.type !== "resolved") return session;
  const entitlement = await new billing.EntitlementService(
    params.planAssignmentProvider ?? new billing.FakeAccountPlanAssignmentProvider(),
  ).resolve(session.session.accountId, params.at);
  return {
    type: "resolved" as const,
    entitlement,
    account: accountDataFor(params.accountData, session.session.accountId),
  };
}

export async function getSelfCareContexts(params: Common) {
  const context = await resolve(params);
  if (context.type !== "resolved") return context;
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
  if (context.type !== "resolved") return context;
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
  if (context.type !== "resolved") return context;
  if (!context.entitlement.policy.features["personalized-self-care"]) {
    return { type: "unavailable" as const, reason: "feature_unavailable" as const };
  }
  const result = await context.account.execute("selfCareContext.revoke", params.id, params.at);
  return { type: "resolved" as const, result };
}
