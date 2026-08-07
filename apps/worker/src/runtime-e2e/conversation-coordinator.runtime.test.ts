import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ConversationCoordinator } from "../conversation-coordinator";

describe("ConversationCoordinator Workers runtime E2E", () => {
  it("実DO RPCでreceipt予約をDurable SQLiteへ永続化しalarmを設定する", async () => {
    const accountId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const stub = env.CONVERSATION_COORDINATOR.getByName(accountId);

    await expect(
      stub.reserveReceipt({ accountId, eventId, receivedAt: new Date().toISOString() }),
    ).resolves.toEqual({ accepted: true });
    await expect(
      stub.reserveReceipt({ accountId, eventId, receivedAt: new Date().toISOString() }),
    ).resolves.toEqual({ accepted: false });

    await runInDurableObject(stub, async (_instance: ConversationCoordinator, state) => {
      expect(
        state.storage.sql
          .exec<{ event_id: string }>(
            "SELECT event_id FROM receipt_reservations WHERE event_id = ?",
            eventId,
          )
          .one().event_id,
      ).toBe(eventId);
      await expect(state.storage.getAlarm()).resolves.toBeTypeOf("number");
    });
  });
});
