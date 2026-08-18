import { type AccountDataNamespace, type D1, accountDataFor } from "@me-builder/lib";
import {
  type ProfileSummaryGenerationQueueMessage,
  type Queue,
  logger,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import type { AuthenticatedActor } from "./authentication/types";

export type RequestProfileSummaryGenerationOutcome =
  | Readonly<{
      type: "accepted";
      generationId: string;
      status: "queued" | "generating";
      created: boolean;
    }>
  | Readonly<{
      type: "unavailable";
      reason: "source_record_required" | "regeneration_not_required";
    }>;

type Params = Readonly<{
  actor: AuthenticatedActor;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
  queue?: Queue<ProfileSummaryGenerationQueueMessage>;
  at?: Date;
}>;

export async function requestProfileSummaryGeneration({
  actor,
  accountData,
  queue,
  at = new Date(),
}: Params): Promise<RequestProfileSummaryGenerationOutcome> {
  if (!accountData || !queue) throw new Error("Profile Summary generation binding is missing");
  const account = accountDataFor(accountData, actor.accountId);
  const request = await account.execute("profileSummary.requestGeneration", at);
  if (request.outcome === "unavailable") return { type: "unavailable", reason: request.reason };
  if (request.needsDispatch) {
    let dispatched = false;
    try {
      await queue.send({
        type: "profile-summary-generation",
        accountId: actor.accountId,
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
