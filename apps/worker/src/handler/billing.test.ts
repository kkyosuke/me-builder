import type { BillingQueueMessage, Message } from "@me-builder/shared";
import { logger } from "@me-builder/shared";
import { describe, expect, it, vi } from "vitest";
import { processBillingMessage } from "./billing";

describe("pending billing queue consumer", () => {
  it("retries a versionless v1-compatible message and identifies the eventual DLQ disposition", async () => {
    const retry = vi.fn();
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const message = {
      id: "message-1",
      timestamp: new Date(),
      attempts: 6,
      body: {
        type: "billing-event",
        traceId: "trace-1",
        eventId: "evt_1",
        eventType: "customer.subscription.updated",
        objectId: "sub_1",
        objectType: "subscription",
        customerId: "cus_1",
        subscriptionId: "sub_1",
        createdAt: "2026-08-15T00:00:00.000Z",
      },
      ack: vi.fn(),
      retry,
    } as Message<BillingQueueMessage>;

    await processBillingMessage(message);

    expect(retry).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({ disposition: "dead-letter", messageVersion: 1 }),
      expect.stringContaining("-> dead-letter"),
    );
    warning.mockRestore();
  });
});
