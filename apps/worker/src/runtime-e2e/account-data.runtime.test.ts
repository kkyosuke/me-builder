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

  it("既存0000 baselineのAccountデータを保ったまま0001と0002を適用できる", async () => {
    const accountId = crypto.randomUUID();
    const stub = env.ACCOUNT_DATA.getByName(accountId);

    await runInDurableObject(stub, async (instance: AccountData, state) => {
      state.storage.sql.exec(
        "INSERT INTO brain_items (id, created_at, updated_at, is_deleted, account_id, category, statement, attributes_json, derivation, status, stability, sensitivity, externally_shareable, confidence_json) VALUES ('migration-brain', 1, 1, 0, ?, 'memory', '散歩した', '{}', 'ai', 'active', 'stable', 'private', 0, '{}')",
        accountId,
      );
      state.storage.sql.exec("DROP TABLE profile_summary_versions");
      state.storage.sql.exec("DROP TABLE profile_summary_generations");
      state.storage.sql.exec("DROP TABLE brain_vector_entries");
      state.storage.sql.exec("DROP TABLE brain_vector_sync_jobs");
      state.storage.sql.exec(
        "DELETE FROM __drizzle_migrations WHERE created_at IN (1786407202292, 1786413718549)",
      );

      const repository = Reflect.get(instance, "repository") as { initialize(): Promise<void> };
      await expect(repository.initialize()).resolves.toBeUndefined();
      expect(
        state.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profile_summary_versions'",
          )
          .one().name,
      ).toBe("profile_summary_versions");
      expect(
        state.storage.sql
          .exec<{ statement: string }>(
            "SELECT statement FROM brain_items WHERE id = 'migration-brain'",
          )
          .one().statement,
      ).toBe("散歩した");
      expect(
        state.storage.sql
          .exec<{ brain_item_id: string; operation: string; status: string }>(
            "SELECT brain_item_id, operation, status FROM brain_vector_sync_jobs WHERE brain_item_id = 'migration-brain'",
          )
          .one(),
      ).toEqual({ brain_item_id: "migration-brain", operation: "upsert", status: "pending" });
    });
  });

  it("Memory化されていない日記本文から生成contextを作り、まとめ版を永続化する", async () => {
    const accountId = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare("INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)")
      .bind(accountId, now, now)
      .run();
    const stub = env.ACCOUNT_DATA.getByName(accountId);
    const source = await stub.execute(accountId, "conversation.storeLineTextSource", {
      eventId: crypto.randomUUID(),
      body: "Memoryにはしていないが、海辺を歩くと落ち着いた。",
      receivedAt: new Date(now),
    });
    await runInDurableObject(stub, async (_instance: AccountData, state) => {
      state.storage.sql.exec(
        "INSERT INTO conversation_sessions (id, created_at, updated_at, is_deleted, account_id, status, started_at, last_user_message_at, conversation_policy_id, reply_opportunity_count, reply_count, awaiting_reply, next_sequence) VALUES ('summary-session', ?, ?, 0, ?, 'closed', ?, ?, 'reflective', 0, 0, 0, 2)",
        now,
        now,
        accountId,
        now,
        now,
      );
      state.storage.sql.exec(
        "INSERT INTO conversation_messages (id, created_at, updated_at, is_deleted, session_id, sequence, role, source_record_id, channel) VALUES ('summary-message', ?, ?, 0, 'summary-session', 1, 'user', ?, 'line')",
        now,
        now,
        source.sourceRecordId,
      );
    });

    const requested = await stub.execute(accountId, "profileSummary.requestGeneration");
    expect(requested).toMatchObject({ outcome: "created", status: "queued" });
    if (requested.outcome !== "created") throw new Error("generation was not created");
    const context = await stub.execute(
      accountId,
      "profileSummary.loadGenerationContext",
      requested.generationId,
    );
    expect(context?.evidence).toEqual([
      expect.objectContaining({
        source: "diary",
        text: "Memoryにはしていないが、海辺を歩くと落ち着いた。",
      }),
    ]);
    if (!context) throw new Error("generation context was not loaded");
    await expect(
      stub.execute(accountId, "profileSummary.completeGeneration", {
        generationId: context.generationId,
        generatedAt: new Date(now + 1_000),
        model: "gemini-test",
        promptVersion: "profile-summary-v1",
        headline: "歩く時間で気持ちを整えています",
        insights: [
          {
            key: "walking",
            label: "歩いて整える",
            description: "歩くことで落ち着きを取り戻すことがあります。",
            evidenceCount: 1,
            sources: ["diary"],
          },
        ],
        diagnosisCount: context.diagnosisCount,
        diaryCount: context.diaryCount,
        latestRecordedAt: context.latestRecordedAt,
      }),
    ).resolves.toBe(true);
    await expect(stub.execute(accountId, "profileSummary.read")).resolves.toMatchObject({
      versions: [
        {
          sequence: 1,
          summary: { headline: "歩く時間で気持ちを整えています", diaryCount: 1 },
        },
      ],
      generation: { status: "idle" },
    });
  });
});
