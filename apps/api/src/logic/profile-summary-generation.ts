import { type AccountDataNamespace, type D1, accountDataFor, billing } from "@me-builder/lib";
import {
  type ProfileSummaryGenerationQueueMessage,
  type Queue,
  logger,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import { createLiffSession } from "./liff-session";

export type RequestProfileSummaryGenerationOutcome =
  | Readonly<{
      type: "accepted";
      generationId: string;
      status: "queued" | "generating";
      created: boolean;
    }>
  | Readonly<{
      type: "unavailable";
      reason: "source_record_required" | "regeneration_not_required" | "limit_reached";
    }>
  | Readonly<{ type: "not-configured" }>
  | Readonly<{ type: "unauthenticated"; reason: string }>
  | Readonly<{ type: "account-not-found" }>;

type Params = Readonly<{
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
  queue?: Queue<ProfileSummaryGenerationQueueMessage>;
  at?: Date;
  allowUnchangedRegeneration?: boolean;
  planAssignmentProvider?: billing.AccountPlanAssignmentProvider;
}>;

export async function requestProfileSummaryGeneration({
  idToken,
  lineLoginChannelId,
  db,
  accountData,
  queue,
  at = new Date(),
  allowUnchangedRegeneration = false,
  planAssignmentProvider,
}: Params): Promise<RequestProfileSummaryGenerationOutcome> {
  const session = await createLiffSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;
  if (!accountData || !queue) throw new Error("Profile Summary generation binding is missing");
  const account = accountDataFor(accountData, session.session.accountId);
  const entitlement = await new billing.EntitlementService(
    new billing.FamilyAwareAccountPlanAssignmentProvider(db, planAssignmentProvider),
  ).resolve(session.session.accountId, at);
  const period = billing.resolveEntitlementUsagePeriod(entitlement, "profile-summary", at);
  const usage = await account.execute(
    "aiUsage.read",
    "profile-summary",
    period,
    entitlement.policy.profileSummary.limit,
    at,
  );
  if (usage.remaining === 0) return { type: "unavailable", reason: "limit_reached" };
  const request = await account.execute(
    "profileSummary.requestGeneration",
    at,
    allowUnchangedRegeneration,
  );
  if (request.outcome === "unavailable") return { type: "unavailable", reason: request.reason };
  if (request.needsDispatch) {
    let dispatched = false;
    try {
      await queue.send({
        type: "profile-summary-generation",
        accountId: session.session.accountId,
        generationId: request.generationId,
      });
      dispatched = true;
    } catch (error) {
      logger.warn(
        {
          event: "profile-summary-generation.dispatch.deferred",
          service: "api",
          component: "profile-summary-generation",
          generationId: request.generationId,
          outcome: "deferred",
          disposition: "account-data-alarm",
          ...toSafeOperationalErrorFields(error, {
            code: "PROFILE_SUMMARY_QUEUE_DISPATCH_DEFERRED",
            category: "dependency",
            stage: "queue.send",
            retryable: true,
            dependency: "cloudflare-queue",
          }),
        },
        "[Profile summary generation] deferred at queue.send -> account-data-alarm",
      );
    }
    if (dispatched) {
      try {
        await account.execute("profileSummary.markGenerationDispatched", request.generationId, at);
      } catch (error) {
        logger.warn(
          {
            event: "profile-summary-generation.dispatch-record.deferred",
            service: "api",
            component: "profile-summary-generation",
            generationId: request.generationId,
            outcome: "deferred",
            disposition: "account-data-alarm",
            ...toSafeOperationalErrorFields(error, {
              code: "PROFILE_SUMMARY_DISPATCH_RECORD_DEFERRED",
              category: "dependency",
              stage: "dispatch.record",
              retryable: true,
              dependency: "account-data",
            }),
          },
          "[Profile summary generation] deferred at dispatch.record -> account-data-alarm",
        );
      }
    }
  }
  return {
    type: "accepted",
    generationId: request.generationId,
    status: request.status,
    created: request.outcome === "created",
  };
}
