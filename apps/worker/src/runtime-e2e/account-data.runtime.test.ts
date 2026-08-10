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

    await runInDurableObject(first, async (_instance: AccountData, state) => {
      state.storage.sql.exec(
        "INSERT INTO brain_items (id, created_at, updated_at, is_deleted, account_id, category, statement, attributes_json, derivation, status, stability, sensitivity, externally_shareable, confidence_json) VALUES ('visible-brain', ?, ?, 0, ?, 'memory', 'private diary', '{}', 'ai', 'active', 'stable', 'private', 0, '{}')",
        now,
        now,
        firstAccountId,
      );
      state.storage.sql.exec(
        "INSERT INTO brain_item_evidence_edges (id, created_at, updated_at, is_deleted, brain_item_id, source_record_id, relation, is_derivation_trigger, derivation_method, generated_at) VALUES ('visible-evidence', ?, ?, 0, 'visible-brain', ?, 'supports', 1, 'ai', ?)",
        now,
        now,
        source.sourceRecordId,
        now,
      );
    });
    await expect(first.execute(firstAccountId, "brain.listActive")).resolves.toMatchObject({
      items: [{ id: "visible-brain", evidence: [{ sourceRecordId: source.sourceRecordId }] }],
      truncated: false,
    });
    await expect(second.execute(secondAccountId, "brain.listActive")).resolves.toEqual({
      items: [],
      truncated: false,
    });

    await runInDurableObject(second, async (_instance: AccountData, state) => {
      expect(() =>
        state.storage.sql.exec(
          "INSERT INTO brain_items (id, created_at, updated_at, is_deleted, account_id, category, statement, attributes_json, derivation, status, stability, sensitivity, externally_shareable, confidence_json) VALUES ('foreign-brain', ?, ?, 0, ?, 'memory', 'private diary', '{}', 'ai', 'active', 'stable', 'private', 0, '{}')",
          now,
          now,
          firstAccountId,
        ),
      ).toThrow();
    });
  });
});
