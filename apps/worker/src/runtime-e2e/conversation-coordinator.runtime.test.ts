import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ConversationCoordinator } from "../conversation-coordinator";

describe("ConversationCoordinator Workers runtime E2E", () => {
  it("実DO RPCで受付messageをDurable SQLiteへ冪等に永続化しalarmを設定する", async () => {
    const accountId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const sourceRecordId = crypto.randomUUID();
    const traceId = crypto.randomUUID();
    const receivedAt = new Date().toISOString();
    const stub = env.CONVERSATION_COORDINATOR.getByName(accountId);

    await expect(
      stub.acceptMessage({ accountId, eventId, sourceRecordId, receivedAt, traceId }),
    ).resolves.toEqual({ accepted: true });
    await expect(
      stub.acceptMessage({ accountId, eventId, sourceRecordId, receivedAt, traceId }),
    ).resolves.toEqual({ accepted: false });

    await runInDurableObject(stub, async (_instance: ConversationCoordinator, state) => {
      expect(
        state.storage.sql
          .exec<{ event_id: string; trace_id: string }>(
            "SELECT event_id, trace_id FROM accepted_messages WHERE event_id = ?",
            eventId,
          )
          .one(),
      ).toEqual({ event_id: eventId, trace_id: traceId });
      await expect(state.storage.getAlarm()).resolves.toBeTypeOf("number");
    });
  });

  it("開発リセットで受付messageとalarmを削除し、別Accountからの操作を拒否する", async () => {
    const accountId = crypto.randomUUID();
    const stub = env.CONVERSATION_COORDINATOR.getByName(accountId);
    await stub.acceptMessage({
      accountId,
      eventId: crypto.randomUUID(),
      sourceRecordId: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
    });

    await expect(stub.resetAccountData(accountId)).resolves.toBeUndefined();
    await runInDurableObject(stub, async (instance: ConversationCoordinator, state) => {
      await expect(instance.resetAccountData(crypto.randomUUID())).rejects.toThrow(
        "does not match object name",
      );
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM accepted_messages")
          .one().count,
      ).toBe(0);
      await expect(state.storage.getAlarm()).resolves.toBeNull();
    });
  });
});
