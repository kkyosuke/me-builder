import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ConversationCoordinator } from "../conversation-coordinator";

describe("ConversationCoordinator Workers runtime E2E", () => {
  it("実DO RPCで受付messageをDurable SQLiteへ冪等に永続化しalarmを設定する", async () => {
    const accountId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const sourceRecordId = crypto.randomUUID();
    const receivedAt = new Date().toISOString();
    const stub = env.CONVERSATION_COORDINATOR.getByName(accountId);

    await expect(
      stub.acceptMessage({ accountId, eventId, sourceRecordId, receivedAt }),
    ).resolves.toEqual({ accepted: true });
    await expect(
      stub.acceptMessage({ accountId, eventId, sourceRecordId, receivedAt }),
    ).resolves.toEqual({ accepted: false });

    await runInDurableObject(stub, async (_instance: ConversationCoordinator, state) => {
      expect(
        state.storage.sql
          .exec<{ event_id: string }>(
            "SELECT event_id FROM accepted_messages WHERE event_id = ?",
            eventId,
          )
          .one().event_id,
      ).toBe(eventId);
      await expect(state.storage.getAlarm()).resolves.toBeTypeOf("number");
    });
  });
});
