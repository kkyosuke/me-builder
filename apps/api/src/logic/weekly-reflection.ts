import {
  type AccountDataNamespace,
  type D1,
  type WeeklyReflectionReadModel,
  accountDataFor,
  billing,
} from "@me-builder/lib";
import type { Queue, ReflectionGenerationQueueMessage } from "@me-builder/shared";
import type { AuthenticatedActor } from "./authentication/types";

type CommonParams = Readonly<{
  actor: AuthenticatedActor;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
  at?: Date;
  planAssignmentProvider?: billing.AccountPlanAssignmentProvider;
}>;

export type WeeklyReflectionOutcome = WeeklyReflectionReadModel & {
  type: "resolved";
  canStartNew: boolean;
};

export async function getWeeklyReflections({
  actor,
  db,
  accountData,
  at = new Date(),
  planAssignmentProvider,
}: CommonParams): Promise<WeeklyReflectionOutcome> {
  if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
  const entitlement = await new billing.EntitlementService(
    new billing.FamilyAwareAccountPlanAssignmentProvider(db, planAssignmentProvider),
  ).resolve(actor.accountId, at);
  const readModel = await accountDataFor(accountData, actor.accountId).execute(
    "weeklyReflection.read",
    at,
    entitlement.policy.monthlyChange,
  );
  return {
    type: "resolved",
    ...readModel,
    canStartNew: entitlement.policy.features["weekly-reflection"],
  };
}

export type RequestWeeklyReflectionOutcome =
  | Readonly<{
      type: "accepted";
      generationId: string;
      status: "queued" | "generating" | "completed";
      created: boolean;
    }>
  | Readonly<{ type: "unavailable"; reason: "feature_unavailable" | "source_record_required" }>;

export async function requestWeeklyReflectionGeneration({
  actor,
  db,
  accountData,
  queue,
  at = new Date(),
  planAssignmentProvider,
}: CommonParams & {
  queue?: Queue<ReflectionGenerationQueueMessage>;
}): Promise<RequestWeeklyReflectionOutcome> {
  if (!accountData || !queue) throw new Error("Weekly reflection binding is missing");
  const entitlement = await new billing.EntitlementService(
    new billing.FamilyAwareAccountPlanAssignmentProvider(db, planAssignmentProvider),
  ).resolve(actor.accountId, at);
  if (!entitlement.policy.features["weekly-reflection"]) {
    return { type: "unavailable", reason: "feature_unavailable" };
  }
  const account = accountDataFor(accountData, actor.accountId);
  const request = await account.execute("weeklyReflection.requestGeneration", at);
  if (request.outcome === "unavailable") return { type: "unavailable", reason: request.reason };
  if (request.needsDispatch) {
    await queue.send({
      type: "weekly-reflection-generation",
      accountId: actor.accountId,
      generationId: request.generationId,
    });
    await account.execute("weeklyReflection.markGenerationDispatched", request.generationId, at);
  }
  return {
    type: "accepted",
    generationId: request.generationId,
    status: request.status,
    created: request.outcome === "created" || request.outcome === "retried",
  };
}
