import { type D1Migration, applyD1Migrations, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { AccountData } from "../account-data";

describe("AccountData Workers runtime E2E", () => {
  beforeAll(async () => {
    const runtimeEnv = env as typeof env & { TEST_D1_MIGRATIONS: D1Migration[] };
    await applyD1Migrations(runtimeEnv.DB, runtimeEnv.TEST_D1_MIGRATIONS);
  });

  it("Accountごとに異なるSQLiteへ保存し、既知のIDでも他Accountから参照できない", async () => {
    const firstAccountId = crypto.randomUUID();
    const secondAccountId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?), (?, ?, ?)",
    )
      .bind(firstAccountId, now, now, secondAccountId, now, now)
      .run();
    const first = env.ACCOUNT_DATA.getByName(firstAccountId);
    const second = env.ACCOUNT_DATA.getByName(secondAccountId);

    await runInDurableObject(first, async (instance: AccountData, state) => {
      expect(
        state.storage.sql
          .exec<{ account_id: string }>(
            "SELECT account_id FROM account_data_identity WHERE singleton = 1",
          )
          .one().account_id,
      ).toBe(firstAccountId);
      await expect(instance.execute(secondAccountId, "source.hasActive")).rejects.toThrow(
        "AccountData RPC account does not match object name",
      );
    });

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
  });
});
