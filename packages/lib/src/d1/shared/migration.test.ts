import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { currentServiceTerms } from "@me-builder/shared";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve(__dirname, "../../../drizzle");

/** 共有D1が保存するのはAccount Identity・運営設定、公開定義、集計projectionだけ。 */
const SHARED_D1_TABLES = [
  "account_agreement_acceptances",
  "account_identities",
  "account_profiles",
  "accounts",
  "catalog_versions",
  "diagnoses",
  "diagnosis_questions",
  "diagnosis_scoring_configs",
  "gemini_usage_records",
  "question_choices",
  "question_versions",
  "questions",
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
    expect(acceptance.documentHash).toBe(currentServiceTerms.contentHash);
    sqlite.close();
  });
});
