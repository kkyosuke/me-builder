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
        "INSERT INTO brain_item_evidence_edges (id, created_at, updated_at, is_deleted, account_id, brain_item_id, source_record_id, relation, is_derivation_trigger, derivation_method, generated_at) VALUES ('visible-evidence', ?, ?, 0, ?, 'visible-brain', ?, 'supports', 1, 'ai', ?)",
        now,
        now,
        firstAccountId,
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
  });

  it("既存Brainデータを持つ配布済み0003 schemaへ0004を追記できる", async () => {
    const accountId = crypto.randomUUID();
    const stub = env.ACCOUNT_DATA.getByName(accountId);

    await runInDurableObject(stub, async (instance: AccountData, state) => {
      state.storage.sql.exec(
        "INSERT INTO brain_items (id, created_at, updated_at, is_deleted, account_id, category, statement, attributes_json, derivation, status, stability, sensitivity, externally_shareable, confidence_json) VALUES ('brain-1', 1, 1, 0, ?, 'memory', '散歩した', '{}', 'ai', 'active', 'stable', 'private', 0, '{}')",
        accountId,
      );
      state.storage.sql.exec(
        "INSERT INTO brain_item_access_labels (id, created_at, updated_at, is_deleted, account_id, brain_item_id, label, assigned_by) VALUES ('label-1', 1, 1, 0, ?, 'brain-1', 'private', 'system')",
        accountId,
      );

      state.storage.sql.exec("DROP TABLE compatibility_references");
      state.storage.sql.exec("DELETE FROM __drizzle_migrations WHERE created_at = 1786270180000");

      const repository = Reflect.get(instance, "repository") as { initialize(): Promise<void> };
      await expect(repository.initialize()).resolves.toBeUndefined();
      expect(
        state.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'compatibility_references'",
          )
          .one().name,
      ).toBe("compatibility_references");
      expect(
        state.storage.sql
          .exec<{ statement: string }>("SELECT statement FROM brain_items WHERE id = 'brain-1'")
          .one().statement,
      ).toBe("散歩した");
    });
  });

  it("idFromString経由でもnamespace IDを維持してstorageを削除できる", async () => {
    const accountId = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare("INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)")
      .bind(accountId, now, now)
      .run();

    const namedStub = env.ACCOUNT_DATA.getByName(accountId);
    await namedStub.execute(accountId, "conversation.storeLineTextSource", {
      eventId: crypto.randomUUID(),
      body: "reset target",
      receivedAt: new Date(),
    });

    const rawId = env.ACCOUNT_DATA.idFromName(accountId).toString();
    const rawStub = env.ACCOUNT_DATA.get(env.ACCOUNT_DATA.idFromString(rawId));
    await rawStub.resetStorage("runtime-reset-token");

    expect(env.ACCOUNT_DATA.idFromName(accountId).toString()).toBe(rawId);
  });
});
