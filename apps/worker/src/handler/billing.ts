import { D1, billing } from "@me-builder/lib";
import type {
  BillingQueueMessage,
  Message,
  OperationalOutcome,
  QueueDisposition,
} from "@me-builder/shared";
import {
  describeQueueMessageResult,
  logger,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import type { WorkerConfig } from "../config";

export const BILLING_QUEUE_MAX_ATTEMPTS = 6;

export interface BillingProjectionStore {
  findCustomer(providerCustomerId: string): Promise<{ accountId: string } | undefined>;
  apply(input: D1BillingProjectionInput): Promise<"applied" | "duplicate" | "stale">;
}

type D1BillingProjectionInput = Parameters<
  typeof D1.shared.action.billing.applyBillingProjection
>[1];

export async function convergeBillingEvent(input: {
  message: BillingQueueMessage;
  provider: billing.BillingProvider;
  store: BillingProjectionStore;
  resolvePlan: (priceId: string | null) => billing.PlanCode | null;
}): Promise<"applied" | "duplicate" | "stale" | "ignored"> {
  const version = input.message.version ?? 1;
  if (version !== 1) return "ignored";
  let subscriptionId = input.message.subscriptionId;
  if (!subscriptionId && input.message.objectType === "subscription") {
    subscriptionId = input.message.objectId;
  }
  let subscription: billing.BillingSubscription | undefined;
  if (subscriptionId) {
    subscription = await input.provider.retrieveSubscription(subscriptionId);
  } else if (input.message.customerId) {
    const subscriptions = await input.provider.listSubscriptions(input.message.customerId);
    subscription = [...subscriptions].sort((left, right) => {
      const leftCurrent = left.status === "active" || left.status === "trialing" ? 1 : 0;
      const rightCurrent = right.status === "active" || right.status === "trialing" ? 1 : 0;
      return rightCurrent - leftCurrent || Date.parse(right.createdAt) - Date.parse(left.createdAt);
    })[0];
  }
  if (!subscription) return "ignored";
  if (input.message.customerId && input.message.customerId !== subscription.customerId) {
    throw new Error("BILLING_EVENT_CUSTOMER_MISMATCH");
  }
  const customer = await input.store.findCustomer(subscription.customerId);
  if (!customer) throw new Error("BILLING_CUSTOMER_NOT_LINKED");
  return await input.store.apply({
    accountId: customer.accountId,
    event: {
      id: input.message.eventId,
      type: input.message.eventType,
      objectId: input.message.objectId,
      createdAt: new Date(input.message.createdAt),
    },
    subscription,
    planCode: input.resolvePlan(subscription.priceId),
  });
}

export async function processBillingMessage(
  message: Message<BillingQueueMessage>,
  db: D1.shared.Client,
  config: WorkerConfig,
): Promise<void> {
  const startedAt = Date.now();
  let outcome: OperationalOutcome = "succeeded";
  let disposition: QueueDisposition = "ack";
  let stage = "billing.projection.apply";
  let resultCode: string | undefined;
  try {
    if (!config.stripeSecretKey) throw new Error("STRIPE_SECRET_KEY_MISSING");
    let projectedAccountId: string | undefined;
    const result = await convergeBillingEvent({
      message: message.body,
      provider: billing.createStripeBillingProvider({ secretKey: config.stripeSecretKey }),
      store: {
        findCustomer: (providerCustomerId) =>
          D1.shared.action.billing.findBillingCustomerByProviderCustomerId(db, providerCustomerId),
        apply: (projection) => {
          projectedAccountId = projection.accountId;
          return D1.shared.action.billing.applyBillingProjection(db, projection);
        },
      },
      resolvePlan: (priceId) => (priceId ? (config.billingPricePlanMap[priceId] ?? null) : null),
    });
    if (projectedAccountId) await reconcileFamilyPack(db, projectedAccountId);
    outcome = result === "ignored" ? "discarded" : "succeeded";
    resultCode = result.toUpperCase();
    message.ack();
  } catch (error) {
    outcome = "failed";
    disposition = message.attempts >= BILLING_QUEUE_MAX_ATTEMPTS ? "dead-letter" : "retry";
    stage = "billing.projection.converge";
    resultCode = "BILLING_PROJECTION_FAILED";
    message.retry();
    const safeError = toSafeOperationalErrorFields(error, {
      code: resultCode,
      category: error instanceof billing.BillingProviderError ? "dependency" : "invariant",
      stage,
      retryable: true,
      ...(error instanceof billing.BillingProviderError ? { dependency: "stripe" } : {}),
      ...(error instanceof billing.BillingProviderError && error.dependencyStatus !== undefined
        ? { dependencyStatus: error.dependencyStatus }
        : {}),
    });
    logger.error(
      {
        event: "queue.message.failed",
        service: "worker",
        component: "billing",
        traceId: message.body.traceId,
        queueMessageId: message.id,
        messageVersion: message.body.version ?? 1,
        attempt: message.attempts,
        outcome,
        disposition,
        ...safeError,
        durationMs: Date.now() - startedAt,
      },
      describeQueueMessageResult({
        flow: "billing",
        outcome,
        disposition,
        stage,
        attempt: message.attempts,
        maxAttempts: BILLING_QUEUE_MAX_ATTEMPTS,
        error: safeError,
      }),
    );
    return;
  }
  logger.info(
    {
      event: "queue.message.completed",
      service: "worker",
      component: "billing",
      traceId: message.body.traceId,
      queueMessageId: message.id,
      messageVersion: message.body.version ?? 1,
      attempt: message.attempts,
      outcome,
      disposition,
      stage,
      resultCode,
      durationMs: Date.now() - startedAt,
    },
    describeQueueMessageResult({
      flow: "billing",
      outcome,
      disposition,
      stage,
      attempt: message.attempts,
      maxAttempts: BILLING_QUEUE_MAX_ATTEMPTS,
      resultCode,
    }),
  );
}

/** 現在の決済projectionへFamily packを冪等に追従させる。 */
export async function reconcileFamilyPack(
  db: D1.shared.Client,
  accountId: string,
  at = new Date(),
): Promise<void> {
  const assignment = await new D1.shared.action.billing.D1AccountPlanAssignmentProvider(
    db,
  ).findCurrent(accountId, at);
  if (assignment.plan === "family" && assignment.source === "subscription") {
    await D1.shared.action.familySeat.createFamilyPack(db, accountId, at);
    return;
  }
  await D1.shared.action.familySeat.endFamilyPack(db, accountId, at);
}
