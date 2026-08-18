import { type AccountDataNamespace, type D1, accountDataFor, billing } from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type CommonParams = Readonly<{
  actor: AuthenticatedActor;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
  at?: Date;
  planAssignmentProvider?: billing.AccountPlanAssignmentProvider;
}>;

const resolve = async (params: CommonParams) => {
  const entitlement = await new billing.EntitlementService(
    new billing.FamilyAwareAccountPlanAssignmentProvider(params.db, params.planAssignmentProvider),
  ).resolve(params.actor.accountId, params.at);
  return {
    type: "resolved" as const,
    accountId: params.actor.accountId,
    entitlement,
    account: accountDataFor(params.accountData, params.actor.accountId),
  };
};

export async function getGoalFollowUps(params: CommonParams) {
  const context = await resolve(params);
  const canManage = context.entitlement.policy.features["goal-follow-up"];
  const model = await context.account.execute("goalFollowUp.read", params.at, canManage);
  return {
    type: "resolved" as const,
    ...model,
    canManage,
    activeLimit: context.entitlement.policy.goalFollowUp === "selected-one" ? 1 : null,
  };
}

export async function agreeGoalFollowUp(
  params: CommonParams & Readonly<{ brainItemId: string; nextStep: string }>,
) {
  const context = await resolve(params);
  if (!context.entitlement.policy.features["goal-follow-up"]) {
    return { type: "unavailable" as const, reason: "feature_unavailable" as const };
  }
  const result = await context.account.execute(
    "goalFollowUp.agree",
    params.brainItemId,
    params.nextStep,
    params.at,
    context.entitlement.policy.goalFollowUp === "selected-one" ? 1 : null,
  );
  if (result.type === "active-limit-reached") {
    return { type: "unavailable" as const, reason: "active_limit" as const };
  }
  return { type: "resolved" as const, result };
}

export async function updateGoalFollowUp(
  params: CommonParams &
    Readonly<{
      id: string;
      input: { status?: "active" | "completed" | "stopped"; nextStep?: string };
    }>,
) {
  const context = await resolve(params);
  if (!context.entitlement.policy.features["goal-follow-up"]) {
    return { type: "unavailable" as const, reason: "feature_unavailable" as const };
  }
  const result = await context.account.execute(
    "goalFollowUp.update",
    params.id,
    params.input,
    params.at,
    context.entitlement.policy.goalFollowUp === "selected-one" ? 1 : null,
  );
  if (result.type === "active-limit-reached") {
    return { type: "unavailable" as const, reason: "active_limit" as const };
  }
  return { type: "resolved" as const, result };
}
