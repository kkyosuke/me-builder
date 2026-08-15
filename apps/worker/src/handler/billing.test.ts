import { billing } from "@me-builder/lib";
import type { BillingQueueMessage } from "@me-builder/shared";
import { describe, expect, it } from "vitest";
import { type BillingProjectionStore, convergeBillingEvent } from "./billing";

const current: billing.BillingSubscription = {
  id: "sub_1",
  customerId: "cus_1",
  status: "active",
  priceId: "price_full",
  currentPeriodStart: "2026-08-01T00:00:00.000Z",
  currentPeriodEnd: "2026-09-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  trialEnd: null,
  createdAt: "2026-08-01T00:00:00.000Z",
};

function event(id: string, createdAt: string): BillingQueueMessage {
  return {
    type: "billing-event",
    version: 1,
    traceId: `trace-${id}`,
    eventId: id,
    eventType: "customer.subscription.updated",
    objectId: "sub_1",
    objectType: "subscription",
    customerId: "cus_1",
    subscriptionId: "sub_1",
    createdAt,
  };
}

function memoryStore() {
  const seen = new Set<string>();
  let projection: billing.BillingSubscription | undefined;
  let lastEventAt = 0;
  const store: BillingProjectionStore = {
    async findCustomer() {
      return { accountId: "account-1" };
    },
    async apply(input) {
      if (seen.has(input.event.id)) return "duplicate";
      seen.add(input.event.id);
      if (input.event.createdAt.getTime() < lastEventAt) return "stale";
      lastEventAt = input.event.createdAt.getTime();
      projection = input.subscription;
      return "applied";
    },
  };
  return { store, projected: () => projection };
}

describe("billing event convergence", () => {
  it("順序逆転と重複でもStripeの現在状態へ収束する", async () => {
    const memory = memoryStore();
    const provider = new billing.FakeBillingProvider({
      retrieveSubscription: async () => current,
    });
    const run = (message: BillingQueueMessage) =>
      convergeBillingEvent({
        message,
        provider,
        store: memory.store,
        resolvePlan: () => "full",
      });

    await expect(run(event("evt_new", "2026-08-15T02:00:00Z"))).resolves.toBe("applied");
    await expect(run(event("evt_new", "2026-08-15T02:00:00Z"))).resolves.toBe("duplicate");
    await expect(run(event("evt_old", "2026-08-15T01:00:00Z"))).resolves.toBe("stale");
    expect(memory.projected()).toEqual(current);
  });

  it("subscription eventが欠落してもinvoiceのCustomerから現在契約を再取得する", async () => {
    const memory = memoryStore();
    const provider = new billing.FakeBillingProvider({ listSubscriptions: async () => [current] });
    const invoiceEvent = {
      ...event("evt_invoice", "2026-08-15T03:00:00Z"),
      eventType: "invoice.paid",
      objectType: "invoice",
      objectId: "in_1",
      subscriptionId: null,
    };
    await expect(
      convergeBillingEvent({
        message: invoiceEvent,
        provider,
        store: memory.store,
        resolvePlan: () => "full",
      }),
    ).resolves.toBe("applied");
    expect(memory.projected()).toEqual(current);
  });
});
