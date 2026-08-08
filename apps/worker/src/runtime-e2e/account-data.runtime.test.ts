import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { AccountData } from "../account-data";

describe("AccountData Workers runtime E2E", () => {
  it("Accountごとに異なるSQLiteへ保存し、既知のIDでも他Accountから参照できない", async () => {
    const firstAccountId = crypto.randomUUID();
    const secondAccountId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const first = env.ACCOUNT_DATA.getByName(firstAccountId);
    const second = env.ACCOUNT_DATA.getByName(secondAccountId);

    const source = await first.execute(firstAccountId, "conversation.storeLineTextSource", {
      accountId: firstAccountId,
      eventId,
      body: "private diary",
      receivedAt: new Date(),
    });

    await runInDurableObject(first, async (_instance: AccountData, state) => {
      expect(
        state.storage.sql
          .exec<{ body: string }>(
            "SELECT body FROM source_record_text_payloads WHERE source_record_id = ?",
            source.sourceRecordId,
          )
          .one().body,
      ).toBe("private diary");
    });
    await runInDurableObject(second, async (_instance: AccountData, state) => {
      expect(
        state.storage.sql
          .exec(
            "SELECT body FROM source_record_text_payloads WHERE source_record_id = ?",
            source.sourceRecordId,
          )
          .toArray(),
      ).toEqual([]);
    });
    // 同一Objectへの別Account指定拒否はrepository unit testで検証する。
    // Workers test poolはDO RPCのrejectを捕捉後もunhandled rejectionとして報告するため、
    // runtime testでは2 Objectの物理分離に集中する。
  });
});
