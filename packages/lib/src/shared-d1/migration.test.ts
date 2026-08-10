import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve(__dirname, "../../drizzle");

/** 共有D1が保存するのはAccount Identity、公開定義、集計projectionだけ。 */
const SHARED_D1_TABLES = [
  "account_identities",
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

const ACCOUNT_OWNED_TABLES = [
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

  it("Account所有tableを共有D1へ作らない", () => {
    const sqlite = applyMigrations();
    const tableNames = new Set(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .pluck()
        .all() as string[],
    );
    for (const table of ACCOUNT_OWNED_TABLES) {
      expect(tableNames.has(table), table).toBe(false);
    }
    sqlite.close();
  });
});
