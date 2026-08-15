import { type D1Migration, applyD1Migrations, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { DO } from "@me-builder/lib";
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

  it("本人進行度の確定値を管理者一覧用の共有D1 projectionへ同期する", async () => {
    const accountId = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare("INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)")
      .bind(accountId, now, now)
      .run();

    await expect(
      env.ACCOUNT_DATA.getByName(accountId).execute(accountId, "progression.read", new Date(now)),
    ).resolves.toMatchObject({
      level: 1,
      growthValue: 0,
      collectedPieces: 0,
      activePieces: 0,
    });

    await expect(
      env.DB.prepare(
        `SELECT calculation_version AS calculationVersion, level, growth_value AS growthValue,
                collected_pieces AS collectedPieces, active_pieces AS activePieces
           FROM account_progression_projections WHERE account_id = ?`,
      )
        .bind(accountId)
        .first(),
    ).resolves.toEqual({
      calculationVersion: 1,
      level: 1,
      growthValue: 0,
      collectedPieces: 0,
      activePieces: 0,
    });
  });

  it("Worker runtimeのQueue bindingから未配送のまとめ生成要求を再送する", async () => {
    const accountId = crypto.randomUUID();
    const generationId = crypto.randomUUID();
    const stub = env.ACCOUNT_DATA.getByName(accountId);

    expect(env.PROFILE_SUMMARY_QUEUE).toBeDefined();
    await runInDurableObject(stub, async (instance: AccountData, state) => {
      state.storage.sql.exec(
        `INSERT INTO profile_summary_generations
          (id, account_id, status, requested_at)
         VALUES (?, ?, 'queued', ?)`,
        generationId,
        accountId,
        Date.now() - 60_000,
      );

      await instance.alarm();

      expect(
        state.storage.sql
          .exec<{ dispatched_at: number | null }>(
            "SELECT dispatched_at FROM profile_summary_generations WHERE id = ?",
            generationId,
          )
          .one().dispatched_at,
      ).toEqual(expect.any(Number));
    });
  });

  it("停止済み設定を保持したまま再開可能なschemaへ移行できる", async () => {
    const accountId = crypto.randomUUID();
    const stub = env.ACCOUNT_DATA.getByName(accountId);

    await runInDurableObject(stub, async (instance: AccountData, state) => {
      state.storage.sql.exec(
        "INSERT INTO source_records (id, created_at, updated_at, is_deleted, account_id, kind, access_label, original_ref) VALUES ('migration-stop-source', 1, 1, 0, ?, 'user_input', 'private', 'line:migration-stop')",
        accountId,
      );
      state.storage.sql.exec("PRAGMA foreign_keys=OFF");
      state.storage.sql.exec("DROP TABLE daily_prompt_preferences");
      state.storage.sql.exec(`CREATE TABLE daily_prompt_preferences (
        account_id text PRIMARY KEY NOT NULL,
        status text NOT NULL,
        stopped_at integer NOT NULL,
        stopped_source_record_id text NOT NULL,
        updated_at integer NOT NULL,
        FOREIGN KEY (account_id) REFERENCES account_data_identity(account_id),
        FOREIGN KEY (stopped_source_record_id) REFERENCES source_records(id)
      )`);
      state.storage.sql.exec(
        "INSERT INTO daily_prompt_preferences (account_id, status, stopped_at, stopped_source_record_id, updated_at) VALUES (?, 'stopped', 2, 'migration-stop-source', 2)",
        accountId,
      );
      state.storage.sql.exec("ALTER TABLE chat_turns DROP COLUMN daily_prompt_follow_up");
      state.storage.sql.exec("ALTER TABLE chat_turns DROP COLUMN collection_kind");
      state.storage.sql.exec("ALTER TABLE chat_turns DROP COLUMN collection_theme_id");
      state.storage.sql.exec("ALTER TABLE daily_prompt_deliveries DROP COLUMN prompt_strategy");
      state.storage.sql.exec("DROP TABLE progression_pending_events");
      state.storage.sql.exec("DROP TABLE progression_item_states");
      state.storage.sql.exec("DROP TABLE progression_states");
      state.storage.sql.exec("DROP TABLE progression_events");
      state.storage.sql.exec("DELETE FROM __drizzle_migrations WHERE created_at >= 1786666843277");

      const repository = Reflect.get(instance, "repository") as { initialize(): Promise<void> };
      await expect(repository.initialize()).resolves.toBeUndefined();

      expect(
        state.storage.sql
          .exec<{ name: string }>("PRAGMA table_info(daily_prompt_preferences)")
          .toArray()
          .map(({ name }) => name),
      ).toEqual([
        "account_id",
        "status",
        "controlled_at",
        "control_source_record_id",
        "updated_at",
      ]);
      expect(
        state.storage.sql
          .exec<{
            status: string;
            controlled_at: number;
            control_source_record_id: string;
          }>("SELECT status, controlled_at, control_source_record_id FROM daily_prompt_preferences")
          .one(),
      ).toEqual({
        status: "stopped",
        controlled_at: 2_000,
        control_source_record_id: "migration-stop-source",
      });
    });
  });

  it("既存0000 baselineのAccountデータを保ったまま後続migrationを適用できる", async () => {
    const accountId = crypto.randomUUID();
    const stub = env.ACCOUNT_DATA.getByName(accountId);

    await runInDurableObject(stub, async (instance: AccountData, state) => {
      state.storage.sql.exec(
        "INSERT INTO brain_items (id, created_at, updated_at, is_deleted, account_id, category, statement, attributes_json, derivation, status, stability, sensitivity, externally_shareable, confidence_json) VALUES ('migration-brain', 1, 1, 0, ?, 'memory', '散歩した', '{}', 'ai', 'active', 'stable', 'private', 0, '{}')",
        accountId,
      );
      state.storage.sql.exec("DROP TABLE profile_summary_share_projections");
      state.storage.sql.exec("DROP TABLE profile_summary_versions");
      state.storage.sql.exec("DROP TABLE profile_summary_generations");
      state.storage.sql.exec("DROP TABLE brain_vector_entries");
      state.storage.sql.exec("DROP TABLE brain_vector_sync_jobs");
      state.storage.sql.exec("DROP TABLE diary_chat_brain_usage_audits");
      state.storage.sql.exec("DROP TABLE daily_prompt_preferences");
      state.storage.sql.exec("DROP TABLE daily_prompt_deliveries");
      state.storage.sql.exec("DROP INDEX diary_brain_checkpoint_item_brain_idx");
      state.storage.sql.exec(
        "ALTER TABLE diary_brain_checkpoint_items DROP COLUMN dedup_prompt_version",
      );
      state.storage.sql.exec("ALTER TABLE diary_brain_checkpoint_items DROP COLUMN deduplication");
      state.storage.sql.exec("ALTER TABLE diary_brain_checkpoint_items DROP COLUMN operation");
      state.storage.sql.exec(
        "CREATE UNIQUE INDEX diary_brain_checkpoint_item_brain_idx ON diary_brain_checkpoint_items (brain_item_id)",
      );
      state.storage.sql.exec("ALTER TABLE account_data_identity DROP COLUMN reset_epoch");
      state.storage.sql.exec("ALTER TABLE diagnoses DROP COLUMN relationship_category");
      state.storage.sql.exec("ALTER TABLE chat_turns DROP COLUMN daily_prompt_follow_up");
      state.storage.sql.exec("ALTER TABLE chat_turns DROP COLUMN collection_kind");
      state.storage.sql.exec("ALTER TABLE chat_turns DROP COLUMN collection_theme_id");
      state.storage.sql.exec("DROP TABLE progression_pending_events");
      state.storage.sql.exec("DROP TABLE progression_item_states");
      state.storage.sql.exec("DROP TABLE progression_states");
      state.storage.sql.exec("DROP TABLE progression_events");
      state.storage.sql.exec("DELETE FROM __drizzle_migrations WHERE created_at > 1786361220917");

      const repository = Reflect.get(instance, "repository") as {
        initialize(): Promise<void>;
        client: Parameters<typeof DO.account.action.profileSummary.readProfileSummary>[0];
      };
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
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'diary_chat_brain_usage_audits'",
          )
          .one().name,
      ).toBe("diary_chat_brain_usage_audits");
      expect(
        state.storage.sql
          .exec<{ name: string }>("PRAGMA table_info(chat_turns)")
          .toArray()
          .map(({ name }) => name),
      ).toEqual(
        expect.arrayContaining([
          "collection_theme_id",
          "collection_kind",
          "daily_prompt_follow_up",
        ]),
      );
      expect(
        state.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profile_summary_share_projections'",
          )
          .one().name,
      ).toBe("profile_summary_share_projections");
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

  it("既存のまとめ版を保って入力snapshot付きschemaへ移行できる", async () => {
    const accountId = crypto.randomUUID();
    const stub = env.ACCOUNT_DATA.getByName(accountId);
    const generatedAt = new Date("2026-08-01T00:00:00.000Z");
    const legacyInputAt = new Date("2026-07-30T00:00:00.000Z");

    await runInDurableObject(stub, async (instance: AccountData, state) => {
      state.storage.sql.exec("PRAGMA foreign_keys=OFF");
      state.storage.sql.exec("DROP TABLE profile_summary_share_projections");
      state.storage.sql.exec("DROP TABLE profile_summary_versions");
      state.storage.sql.exec(`CREATE TABLE profile_summary_versions (
        id text PRIMARY KEY NOT NULL,
        account_id text NOT NULL,
        generation_id text NOT NULL UNIQUE,
        sequence integer NOT NULL,
        generated_at integer NOT NULL,
        model text NOT NULL,
        prompt_version text NOT NULL,
        summary_json text NOT NULL
      )`);
      state.storage.sql.exec(
        "INSERT INTO profile_summary_generations (id, account_id, status, requested_at, finished_at, model, prompt_version) VALUES ('migration-generation', ?, 'completed', 1, 2, 'gemini-test', 'v1')",
        accountId,
      );
      state.storage.sql.exec("ALTER TABLE profile_summary_generations DROP COLUMN dispatched_at");
      state.storage.sql.exec(
        "INSERT INTO brain_items (id, created_at, updated_at, is_deleted, account_id, category, statement, attributes_json, derivation, status, stability, sensitivity, externally_shareable, confidence_json) VALUES ('migration-diary-brain', ?, ?, 0, ?, 'memory', '既存版で使用済みの記録', '{}', 'ai', 'active', 'stable', 'private', 0, '{}')",
        legacyInputAt.getTime() / 1_000,
        legacyInputAt.getTime() / 1_000,
        accountId,
      );
      state.storage.sql.exec(
        `INSERT INTO profile_summary_versions
          (id, account_id, generation_id, sequence, generated_at, model, prompt_version, summary_json)
         VALUES ('migration-version', ?, 'migration-generation', 1, ?, 'gemini-test', 'v1',
          '{"generatedAt":"2026-08-01T00:00:00.000Z","headline":"既存版","insights":[],"recordCount":1,"diagnosisCount":0,"diaryCount":0,"latestRecordedAt":"2026-07-30T00:00:00.000Z"}')`,
        accountId,
        generatedAt.getTime(),
      );
      state.storage.sql.exec("DROP TABLE diary_chat_brain_usage_audits");
      state.storage.sql.exec("DROP TABLE daily_prompt_preferences");
      state.storage.sql.exec("DROP TABLE daily_prompt_deliveries");
      state.storage.sql.exec("DROP INDEX diary_brain_checkpoint_item_brain_idx");
      state.storage.sql.exec(
        "ALTER TABLE diary_brain_checkpoint_items DROP COLUMN dedup_prompt_version",
      );
      state.storage.sql.exec("ALTER TABLE diary_brain_checkpoint_items DROP COLUMN deduplication");
      state.storage.sql.exec("ALTER TABLE diary_brain_checkpoint_items DROP COLUMN operation");
      state.storage.sql.exec(
        "CREATE UNIQUE INDEX diary_brain_checkpoint_item_brain_idx ON diary_brain_checkpoint_items (brain_item_id)",
      );
      state.storage.sql.exec("ALTER TABLE account_data_identity DROP COLUMN reset_epoch");
      state.storage.sql.exec("ALTER TABLE diagnoses DROP COLUMN relationship_category");
      state.storage.sql.exec("ALTER TABLE chat_turns DROP COLUMN daily_prompt_follow_up");
      state.storage.sql.exec("ALTER TABLE chat_turns DROP COLUMN collection_kind");
      state.storage.sql.exec("ALTER TABLE chat_turns DROP COLUMN collection_theme_id");
      state.storage.sql.exec("DROP TABLE progression_pending_events");
      state.storage.sql.exec("DROP TABLE progression_item_states");
      state.storage.sql.exec("DROP TABLE progression_states");
      state.storage.sql.exec("DROP TABLE progression_events");
      state.storage.sql.exec("DELETE FROM __drizzle_migrations WHERE created_at >= 1786415351981");

      const repository = Reflect.get(instance, "repository") as {
        initialize(): Promise<void>;
        client: Parameters<typeof DO.account.action.profileSummary.readProfileSummary>[0];
      };
      await expect(repository.initialize()).resolves.toBeUndefined();
      const version = state.storage.sql
        .exec<{
          headline: string;
          diagnosis_input_count: number;
          diary_input_count: number;
        }>(
          `SELECT json_extract(summary_json, '$.headline') AS headline,
                  diagnosis_input_count, diary_input_count
             FROM profile_summary_versions WHERE id = 'migration-version'`,
        )
        .one();
      expect(version).toEqual({
        headline: "既存版",
        diagnosis_input_count: 0,
        diary_input_count: 1,
      });
      expect(
        state.storage.sql
          .exec<{ name: string }>("PRAGMA table_info(profile_summary_versions)")
          .toArray()
          .map(({ name }) => name),
      ).not.toContain("account_id");
      const readModel = await DO.account.action.profileSummary.readProfileSummary(
        repository.client,
        accountId,
        new Date("2026-08-02T00:00:00.000Z"),
      );
      expect(readModel.generation).toMatchObject({ canRegenerate: true, reasons: ["format"] });

      const addedAt = new Date("2026-08-03T00:00:00.000Z");
      state.storage.sql.exec(
        "INSERT INTO brain_items (id, created_at, updated_at, is_deleted, account_id, category, statement, attributes_json, derivation, status, stability, sensitivity, externally_shareable, confidence_json) VALUES ('migration-new-diary-brain', ?, ?, 0, ?, 'memory', '移行後に増えた記録', '{}', 'ai', 'active', 'stable', 'private', 0, '{}')",
        addedAt.getTime() / 1_000,
        addedAt.getTime() / 1_000,
        accountId,
      );
      const changed = await DO.account.action.profileSummary.readProfileSummary(
        repository.client,
        accountId,
        addedAt,
      );
      expect(changed.generation).toMatchObject({
        canRegenerate: true,
        reasons: ["brain", "format"],
      });
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
        compatibilityShareStatements: [
          {
            key: "reflecting",
            label: "振り返る時間",
            statement: "私は、落ち着いて振り返る時間を大切にしています",
            evidenceIds: [context.evidence[0]?.id ?? ""],
          },
        ],
        diagnosisCount: context.diagnosisCount,
        diaryCount: context.diaryCount,
        latestRecordedAt: context.latestRecordedAt,
        inputSnapshot: context.inputSnapshot,
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
    await expect(
      stub.execute(accountId, "profileSummary.readCompatibilityShareProfile"),
    ).resolves.toMatchObject({
      type: "available",
      profile: {
        statements: [
          {
            key: "reflecting",
            statement: "私は、落ち着いて振り返る時間を大切にしています",
          },
        ],
      },
    });
  });
});
