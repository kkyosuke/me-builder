import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { currentServiceTerms, serviceTermsDocuments } from "@me-builder/shared";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve(__dirname, "../../../drizzle");

/** 共有D1が保存するのはAccount Identity・課金membership・運営設定、公開定義、集計projectionだけ。 */
const SHARED_D1_TABLES = [
  "account_agreement_acceptances",
  "account_identities",
  "account_profiles",
  "account_progression_projections",
  "account_recovery_audits",
  "account_recovery_credentials",
  "account_recovery_rate_limits",
  "accounts",
  "billing_customers",
  "billing_processed_events",
  "billing_reconciliation_audits",
  "billing_subscription_projections",
  "billing_trial_usages",
  "catalog_versions",
  "development_operation_audits",
  "diagnoses",
  "diagnosis_questions",
  "diagnosis_scoring_configs",
  "family_packs",
  "family_seat_invitations",
  "family_seats",
  "gemini_usage_records",
  "question_choices",
  "question_versions",
  "questions",
  "sso_authentication_transaction_claims",
];

const PERSONAL_CONTENT_TABLES = [
  "brain_item_access_labels",
  "brain_item_evidence_edges",
  "brain_item_revisions",
  "brain_item_topic_labels",
  "brain_items",
  "chat_turns",
  "conversation_messages",
  "conversation_sessions",
  "diagnosis_answers",
  "diagnosis_brain_projection_heads",
  "diagnosis_brain_projection_requests",
  "diagnosis_deferred_questions",
  "diagnosis_responses",
  "diary_brain_checkpoint_items",
  "diary_brain_checkpoints",
  "source_record_revisions",
  "source_record_text_payloads",
  "source_records",
];

const REVIEWED_DESTRUCTIVE_MIGRATIONS = new Set([
  "shared/0006_plain_paladin.sql",
  "account/0003_conscious_sheva_callister.sql",
  "account/0013_flat_silver_samurai.sql",
  "compatibility/0001_yummy_radioactive_man.sql",
]);

const MIGRATION_FAMILIES = [
  { name: "shared", directory: migrationsDirectory },
  { name: "account", directory: path.resolve(__dirname, "../../../drizzle-do-account") },
  {
    name: "compatibility",
    directory: path.resolve(__dirname, "../../../../../apps/worker/drizzle/compatibility-data"),
  },
  {
    name: "coordinator",
    directory: path.resolve(
      __dirname,
      "../../../../../apps/worker/drizzle/conversation-coordinator",
    ),
  },
] as const;

function applyMigrations() {
  const files = readdirSync(migrationsDirectory)
    .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
    .sort();
  expect(files[0]).toMatch(/^0000_.+\.sql$/);
  expect(files.map((filename) => filename.slice(0, 4))).toEqual(
    files.map((_, index) => index.toString().padStart(4, "0")),
  );

  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of files) {
    sqlite.exec(readFileSync(path.join(migrationsDirectory, file), "utf8"));
  }
  return sqlite;
}

describe("shared D1 clean baseline migration", () => {
  it("未審査の破壊的migrationを追加しない", () => {
    const destructive = MIGRATION_FAMILIES.flatMap(({ name, directory }) =>
      readdirSync(directory)
        .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
        .filter((filename) =>
          /\b(?:DROP\s+(?:TABLE|COLUMN)|RENAME\s+(?:TABLE|COLUMN))\b/i.test(
            readFileSync(path.join(directory, filename), "utf8"),
          ),
        )
        .map((filename) => `${name}/${filename}`),
    );

    expect(destructive.sort()).toEqual([...REVIEWED_DESTRUCTIVE_MIGRATIONS].sort());
  });

  it("0000から全migrationを適用して現在schemaを作成する", () => {
    const sqlite = applyMigrations();
    const tableNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .pluck()
      .all() as string[];
    expect(tableNames).toEqual(SHARED_D1_TABLES);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("個人コンテンツtableを共有D1へ作らない", () => {
    const sqlite = applyMigrations();
    const tableNames = new Set(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .pluck()
        .all() as string[],
    );
    for (const table of PERSONAL_CONTENT_TABLES) {
      expect(tableNames.has(table), table).toBe(false);
    }
    sqlite.close();
  });

  it("既存の規約同意へ本文hashをbackfillして証跡を維持する", () => {
    const sqlite = new Database(":memory:");
    const migrations = readdirSync(migrationsDirectory)
      .filter((filename) => /^000[0-3]_.+\.sql$/.test(filename))
      .sort();
    for (const file of migrations) {
      sqlite.exec(readFileSync(path.join(migrationsDirectory, file), "utf8"));
    }
    sqlite
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
         VALUES ('account-1', 1, 1, 0, 'active')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO account_agreement_acceptances (
           id, created_at, updated_at, is_deleted, account_id,
           document_key, document_version, accepted_at
         ) VALUES ('acceptance-1', 1, 1, 0, 'account-1',
           'terms_of_service', '2026-08-15', '2026-08-15T00:00:00.000Z')`,
      )
      .run();

    sqlite.exec(readFileSync(path.join(migrationsDirectory, "0004_glossy_patch.sql"), "utf8"));

    const acceptance = sqlite
      .prepare("SELECT document_hash AS documentHash FROM account_agreement_acceptances")
      .get() as { documentHash: string };
    expect(acceptance.documentHash).toBe(serviceTermsDocuments[0].contentHash);
    sqlite.close();
  });

  it("0005で削除済み同意と同じversionへの再同意を許可する", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const existingMigrations = readdirSync(migrationsDirectory)
      .filter((filename) => /^000[0-4]_.+\.sql$/.test(filename))
      .sort();
    for (const file of existingMigrations) {
      sqlite.exec(readFileSync(path.join(migrationsDirectory, file), "utf8"));
    }
    sqlite
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
         VALUES ('account-reaccept', 1, 1, 0, 'active')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO account_agreement_acceptances (
           id, created_at, updated_at, deleted_at, is_deleted, account_id,
           document_key, document_version, document_hash, accepted_at
         ) VALUES ('acceptance-deleted', 1, 2, 2, 1, 'account-reaccept',
           'terms_of_service', ?, ?, '2026-08-15T00:00:00.000Z')`,
      )
      .run(currentServiceTerms.version, currentServiceTerms.contentHash);

    const migration = readdirSync(migrationsDirectory).find((filename) =>
      /^0005_.+\.sql$/.test(filename),
    );
    if (!migration) throw new Error("0005 migration is missing");
    sqlite.exec(readFileSync(path.join(migrationsDirectory, migration), "utf8"));
    sqlite
      .prepare(
        `INSERT INTO account_agreement_acceptances (
           id, created_at, updated_at, is_deleted, account_id,
           document_key, document_version, document_hash, accepted_at
         ) VALUES ('acceptance-active', 3, 3, 0, 'account-reaccept',
           'terms_of_service', ?, ?, '2026-08-15T01:00:00.000Z')`,
      )
      .run(currentServiceTerms.version, currentServiceTerms.contentHash);

    const acceptances = sqlite
      .prepare(
        `SELECT id, is_deleted AS isDeleted
         FROM account_agreement_acceptances
         WHERE account_id = 'account-reaccept'
         ORDER BY id`,
      )
      .all() as Array<{ id: string; isDeleted: number }>;
    expect(acceptances).toEqual([
      { id: "acceptance-active", isDeleted: 0 },
      { id: "acceptance-deleted", isDeleted: 1 },
    ]);
    const indexSql = sqlite
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'index' AND name = 'account_agreement_version_idx'`,
      )
      .pluck()
      .get() as string;
    expect(indexSql).toContain("WHERE is_deleted = 0");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("0006の表示名column追加時に既存のアバターmetadataを維持する", () => {
    const sqlite = new Database(":memory:");
    const migrations = readdirSync(migrationsDirectory)
      .filter((filename) => /^000[0-5]_.+\.sql$/.test(filename))
      .sort();
    for (const file of migrations) {
      sqlite.exec(readFileSync(path.join(migrationsDirectory, file), "utf8"));
    }
    sqlite
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
         VALUES ('account-avatar', 1, 1, 0, 'active')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO account_profiles (
           account_id, avatar_object_key, avatar_content_type, avatar_byte_size,
           avatar_etag, avatar_updated_at
         ) VALUES ('account-avatar', 'accounts/account-avatar/profile/avatar/hash.webp',
           'image/webp', 1234, 'etag-1', 1000)`,
      )
      .run();

    sqlite.exec(readFileSync(path.join(migrationsDirectory, "0006_plain_paladin.sql"), "utf8"));

    expect(
      sqlite
        .prepare(
          `SELECT display_name AS displayName, avatar_object_key AS avatarObjectKey,
                  avatar_content_type AS avatarContentType, avatar_byte_size AS avatarByteSize,
                  avatar_etag AS avatarEtag, avatar_updated_at AS avatarUpdatedAt
           FROM account_profiles WHERE account_id = 'account-avatar'`,
        )
        .get(),
    ).toEqual({
      displayName: null,
      avatarObjectKey: "accounts/account-avatar/profile/avatar/hash.webp",
      avatarContentType: "image/webp",
      avatarByteSize: 1234,
      avatarEtag: "etag-1",
      avatarUpdatedAt: 1000,
    });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });
});
