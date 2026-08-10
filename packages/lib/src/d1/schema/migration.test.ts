import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve(__dirname, "../../../drizzle");

function migrationFiles() {
  return readdirSync(migrationsDirectory)
    .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
    .sort();
}

describe("D1 clean baseline migration", () => {
  it("0000から全migrationを適用して現在schemaを作成する", () => {
    const files = migrationFiles();
    expect(files[0]).toMatch(/^0000_.+\.sql$/);
    expect(files.map((filename) => filename.slice(0, 4))).toEqual(
      files.map((_, index) => index.toString().padStart(4, "0")),
    );

    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    for (const file of files) {
      sqlite.exec(readFileSync(path.join(migrationsDirectory, file), "utf8"));
    }

    const tableNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .pluck()
      .all() as string[];
    expect(tableNames).toEqual(
      expect.arrayContaining([
        "accounts",
        "diagnoses",
        "diagnosis_responses",
        "source_records",
        "conversation_sessions",
        "brain_items",
        "brain_vector_sync_jobs",
      ]),
    );
    expect(tableNames).not.toEqual(
      expect.arrayContaining([
        "surveys",
        "survey_answers",
        "survey_deferred_questions",
        "survey_questions",
        "survey_responses",
      ]),
    );

    const diagnosisColumns = (
      sqlite.pragma("table_info(diagnoses)") as Array<{ name: string }>
    ).map((column) => column.name);
    expect(diagnosisColumns).toEqual(
      expect.arrayContaining(["scoring_config_id", "display_order"]),
    );

    for (const table of [
      "source_record_revisions",
      "source_record_text_payloads",
      "conversation_messages",
      "chat_turns",
      "diary_brain_checkpoint_items",
      "diagnosis_answers",
      "diagnosis_deferred_questions",
      "diagnosis_brain_projection_requests",
    ]) {
      const columns = (sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map(
        (column) => column.name,
      );
      expect(columns, table).not.toContain("account_id");
    }
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });
});
