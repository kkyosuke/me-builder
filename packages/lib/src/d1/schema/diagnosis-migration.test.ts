import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve(__dirname, "../../../drizzle");

function applyMigration(sqlite: Database.Database, filename: string) {
  sqlite.exec(readFileSync(path.join(migrationsDirectory, filename), "utf8"));
}

describe("Diagnosis D1 migration", () => {
  it("既存の診断・回答データを保持したまま旧テーブルと列をrenameする", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    for (const filename of [
      "0000_abnormal_bullseye.sql",
      "0001_optimal_madame_hydra.sql",
      "0002_marvelous_hex.sql",
      "0003_square_power_pack.sql",
      "0004_puzzling_la_nuit.sql",
    ]) {
      applyMigration(sqlite, filename);
    }

    sqlite.exec(`
      INSERT INTO accounts (id, created_at, updated_at) VALUES ('account-1', 1, 1);
      INSERT INTO questions (id, created_at, updated_at) VALUES ('question-1', 1, 1);
      INSERT INTO question_versions (
        created_at, updated_at, question_id, version, state, text, format, approved_at
      ) VALUES (1, 1, 'question-1', 1, 'approved', '質問', 'single_choice', 1);
      INSERT INTO question_choices (
        created_at, updated_at, question_id, question_version, choice_id, label, position
      ) VALUES (1, 1, 'question-1', 1, 'yes', 'はい', 0);
      INSERT INTO surveys (
        id, created_at, updated_at, title, description, opens_at, state, published_at
      ) VALUES ('diagnosis-1', 1, 1, '診断', '診断の説明', 1, 'published', 1);
      INSERT INTO survey_questions (
        id, created_at, updated_at, survey_id, question_id, question_version, position
      ) VALUES ('sq-1', 1, 1, 'diagnosis-1', 'question-1', 1, 0);
      INSERT INTO survey_responses (
        id, created_at, updated_at, account_id, survey_id
      ) VALUES ('response-1', 1, 1, 'account-1', 'diagnosis-1');
      INSERT INTO source_records (
        id, created_at, updated_at, account_id, kind
      ) VALUES ('source-1', 1, 1, 'account-1', 'user_input');
      INSERT INTO survey_answers (
        id, created_at, updated_at, survey_response_id, survey_question_id,
        question_id, question_version, choice_id, accepted_at, source_record_id
      ) VALUES (
        'answer-1', 1, 1, 'response-1', 'sq-1',
        'question-1', 1, 'yes', 1, 'source-1'
      );
      INSERT INTO survey_deferred_questions (
        id, created_at, updated_at, survey_response_id, survey_question_id, deferred_at
      ) VALUES ('deferred-1', 1, 1, 'response-1', 'sq-1', 1);
    `);

    applyMigration(sqlite, "0005_rename_diagnosis.sql");

    const tableNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .pluck()
      .all() as string[];
    expect(tableNames).toEqual(expect.arrayContaining(["diagnoses", "diagnosis_answers"]));
    expect(tableNames).not.toEqual(
      expect.arrayContaining([
        "surveys",
        "survey_answers",
        "survey_deferred_questions",
        "survey_questions",
        "survey_responses",
      ]),
    );
    expect(sqlite.prepare("SELECT id, title FROM diagnoses").get()).toEqual({
      id: "diagnosis-1",
      title: "診断",
    });
    expect(
      sqlite
        .prepare(
          `SELECT diagnosis_response_id, diagnosis_question_id, source_record_id
             FROM diagnosis_answers`,
        )
        .get(),
    ).toEqual({
      diagnosis_response_id: "response-1",
      diagnosis_question_id: "dq-1",
      source_record_id: "source-1",
    });
    expect(
      sqlite.prepare("SELECT id, diagnosis_question_id FROM diagnosis_deferred_questions").get(),
    ).toEqual({ id: "deferred-1", diagnosis_question_id: "dq-1" });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);

    sqlite.close();
  });

  it("既存Diagnosisを保持したまま版付き採点設定を参照可能にする", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    for (const filename of [
      "0000_abnormal_bullseye.sql",
      "0001_optimal_madame_hydra.sql",
      "0002_marvelous_hex.sql",
      "0003_square_power_pack.sql",
      "0004_puzzling_la_nuit.sql",
      "0005_rename_diagnosis.sql",
    ]) {
      applyMigration(sqlite, filename);
    }
    sqlite.exec(`
      INSERT INTO diagnoses (
        id, created_at, updated_at, title, description, opens_at, state, published_at
      ) VALUES ('diagnosis-existing', 1, 1, '既存診断', '説明', 1, 'published', 1);
    `);

    applyMigration(sqlite, "0006_grey_krista_starr.sql");

    expect(sqlite.prepare("SELECT id, scoring_config_id FROM diagnoses").get()).toEqual({
      id: "diagnosis-existing",
      scoring_config_id: null,
    });

    sqlite.exec(`
      INSERT INTO diagnosis_scoring_configs (
        id, created_at, updated_at, version, definition
      ) VALUES ('scoring-v1', 1, 1, 1, '{}');
      UPDATE diagnoses SET scoring_config_id = 'scoring-v1' WHERE id = 'diagnosis-existing';
    `);
    expect(sqlite.prepare("SELECT scoring_config_id FROM diagnoses").get()).toEqual({
      scoring_config_id: "scoring-v1",
    });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);

    sqlite.close();
  });
});
