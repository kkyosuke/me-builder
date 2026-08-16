import { createHmac } from "node:crypto";
import { billing } from "@me-builder/lib";
import type { BillingQueueMessage, Queue } from "@me-builder/shared";
import { describe, expect, it, vi } from "vitest";
import { receiveStripeWebhook } from "./stripe-webhook";

const secret = "whsec_fixture_secret";
const payload = JSON.stringify({
  id: "evt_fixture",
  object: "event",
  api_version: "2026-07-29.dahlia",
  created: 1_786_723_200,
  data: {
    object: {
      id: "sub_fixture",
      object: "subscription",
      customer: "cus_fixture",
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
  type: "customer.subscription.updated",
});

function signature(body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

function fixture() {
  const send = vi.fn().mockResolvedValue(undefined);
  return {
    send,
    queue: { send } as unknown as Queue<BillingQueueMessage>,
    provider: billing.createStripeBillingProvider({ secretKey: "sk_test_fixture" }),
  };
}

describe("receiveStripeWebhook", () => {
  it("raw bodyと署名を検証し、本文を含めずQueueへ渡す", async () => {
    const { send, queue, provider } = fixture();
    await expect(
      receiveStripeWebhook({
        rawBody: payload,
        signature: signature(payload),
        webhookSecret: secret,
        provider,
        queue,
      }),
    ).resolves.toMatchObject({ type: "accepted", eventId: "evt_fixture" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "billing-event",
        version: 1,
        eventId: "evt_fixture",
        subscriptionId: "sub_fixture",
        customerId: "cus_fixture",
      }),
    );
    expect(JSON.stringify(send.mock.calls)).not.toContain('"data"');
  });

  it("改ざんpayloadを拒否する", async () => {
    const { send, queue, provider } = fixture();
    const outcome = await receiveStripeWebhook({
      rawBody: `${payload} `,
      signature: signature(payload),
      webhookSecret: secret,
      provider,
      queue,
    });
    expect(outcome).toEqual({ type: "invalid-signature" });
    expect(send).not.toHaveBeenCalled();
  });

  it("再送を同じevent IDでQueueへ渡し、同期projection更新を行わない", async () => {
    const { send, queue, provider } = fixture();
    const input = {
      rawBody: payload,
      signature: signature(payload),
      webhookSecret: secret,
      provider,
      queue,
    };
    await receiveStripeWebhook(input);
    await receiveStripeWebhook(input);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([message]) => message.eventId)).toEqual([
      "evt_fixture",
      "evt_fixture",
    ]);
  });
});
