import type { BillingQueueMessage, Message } from "@me-builder/shared";
import { describeQueueMessageResult, logger } from "@me-builder/shared";

export const BILLING_QUEUE_MAX_ATTEMPTS = 6;

/** Projection consumerが入るまでeventを失わず、最終試行後はCloudflare DLQへ送る。 */
export async function processBillingMessage(message: Message<BillingQueueMessage>): Promise<void> {
  message.retry();
  const finalAttempt = message.attempts >= BILLING_QUEUE_MAX_ATTEMPTS;
  logger.warn(
    {
      event: "queue.message.deferred",
      service: "worker",
      component: "billing",
      traceId: message.body.traceId,
      queueMessageId: message.id,
      messageType: "billing-event",
      messageVersion: message.body.version ?? 1,
      attempt: message.attempts,
      outcome: "deferred",
      disposition: finalAttempt ? "dead-letter" : "retry",
      stage: "billing.consumer.pending",
      resultCode: "BILLING_CONSUMER_PENDING",
    },
    describeQueueMessageResult({
      flow: "billing",
      outcome: "deferred",
      disposition: finalAttempt ? "dead-letter" : "retry",
      stage: "billing.consumer.pending",
      attempt: message.attempts,
      maxAttempts: BILLING_QUEUE_MAX_ATTEMPTS,
      resultCode: "BILLING_CONSUMER_PENDING",
    }),
  );
}
