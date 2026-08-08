import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve(__dirname, "../../../drizzle");
const migrationsBeforeAccountBoundary = [
  "0000_abnormal_bullseye.sql",
  "0001_optimal_madame_hydra.sql",
  "0002_marvelous_hex.sql",
  "0003_square_power_pack.sql",
  "0004_puzzling_la_nuit.sql",
  "0005_rename_diagnosis.sql",
  "0006_grey_krista_starr.sql",
  "0007_lethal_killraven.sql",
  "0008_dashing_vector.sql",
  "0009_salty_puppet_master.sql",
  "0010_rare_goblin_queen.sql",
  "0011_sad_the_phantom.sql",
  "0012_curvy_marten_broadcloak.sql",
] as const;

function applyMigration(sqlite: Database.Database, filename: string) {
  sqlite.exec(readFileSync(path.join(migrationsDirectory, filename), "utf8"));
}

describe("Account boundary migration", () => {
  it("既存のAccount所有行へ所有者をbackfillして制約を有効にする", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    for (const filename of migrationsBeforeAccountBoundary) applyMigration(sqlite, filename);

    sqlite.exec(`
      INSERT INTO accounts (id, created_at, updated_at) VALUES ('account-1', 1, 1);
      INSERT INTO source_records (id, created_at, updated_at, account_id, kind)
        VALUES ('source-1', 1, 1, 'account-1', 'user_input'),
               ('source-2', 1, 1, 'account-1', 'user_input');
      INSERT INTO source_record_revisions (
        id, created_at, updated_at, previous_source_record_id, next_source_record_id,
        derivation_method
      ) VALUES ('source-revision-1', 1, 1, 'source-1', 'source-2', 'deterministic');
      INSERT INTO source_record_text_payloads (
        source_record_id, body, content_type, content_hash, created_at
      ) VALUES ('source-1', '本文', 'text/plain', 'hash', 1);

      INSERT INTO conversation_sessions (
        id, created_at, updated_at, account_id, status, started_at, last_user_message_at
      ) VALUES ('session-1', 1, 1, 'account-1', 'active', 1, 1);
      INSERT INTO conversation_messages (
        id, created_at, updated_at, session_id, sequence, role, source_record_id, channel, turn_id
      ) VALUES ('message-1', 1, 1, 'session-1', 1, 'user', 'source-1', 'line', 'turn-1');
      INSERT INTO chat_turns (
        id, created_at, updated_at, session_id, from_sequence, through_sequence,
        generation_epoch, status, prompt_version, model, received_at
      ) VALUES ('turn-1', 1, 1, 'session-1', 1, 1, 1, 'queued', 'v1', 'model', 1);

      INSERT INTO questions (id, created_at, updated_at) VALUES ('question-1', 1, 1);
      INSERT INTO question_versions (
        created_at, updated_at, question_id, version, state, text, format
      ) VALUES (1, 1, 'question-1', 1, 'approved', '質問', 'single_choice');
      INSERT INTO question_choices (
        created_at, updated_at, question_id, question_version, choice_id, label, position
      ) VALUES (1, 1, 'question-1', 1, 'yes', 'はい', 1);
      INSERT INTO diagnoses (
        id, created_at, updated_at, title, description, opens_at, state
      ) VALUES ('diagnosis-1', 1, 1, '診断', '説明', 1, 'published');
      INSERT INTO diagnosis_questions (
        id, created_at, updated_at, diagnosis_id, question_id, question_version, position
      ) VALUES ('diagnosis-question-1', 1, 1, 'diagnosis-1', 'question-1', 1, 1);
      INSERT INTO diagnosis_responses (
        id, created_at, updated_at, account_id, diagnosis_id, revision
      ) VALUES ('response-1', 1, 1, 'account-1', 'diagnosis-1', 1);
      INSERT INTO diagnosis_answers (
        id, created_at, updated_at, diagnosis_response_id, diagnosis_question_id,
        question_id, question_version, choice_id, accepted_at, source_record_id
      ) VALUES (
        'answer-1', 1, 1, 'response-1', 'diagnosis-question-1',
        'question-1', 1, 'yes', 1, 'source-2'
      );
      INSERT INTO diagnosis_deferred_questions (
        id, created_at, updated_at, diagnosis_response_id, diagnosis_question_id, deferred_at
      ) VALUES ('deferred-1', 1, 1, 'response-1', 'diagnosis-question-1', 1);
      INSERT INTO diagnosis_brain_projection_requests (
        id, created_at, updated_at, diagnosis_response_id, response_revision,
        status, next_attempt_at
      ) VALUES ('request-1', 1, 1, 'response-1', 1, 'pending', 1);
    `);

    applyMigration(sqlite, "0013_majestic_giant_man.sql");

    for (const table of [
      "source_record_revisions",
      "source_record_text_payloads",
      "conversation_messages",
      "chat_turns",
      "diagnosis_answers",
      "diagnosis_deferred_questions",
      "diagnosis_brain_projection_requests",
    ]) {
      expect(sqlite.prepare(`SELECT account_id FROM ${table}`).pluck().all()).toEqual([
        "account-1",
      ]);
    }
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("既存データが別Accountを関連付けていたらmigrationを中止する", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    for (const filename of migrationsBeforeAccountBoundary) applyMigration(sqlite, filename);
    sqlite.exec(`
      INSERT INTO accounts (id, created_at, updated_at)
        VALUES ('account-1', 1, 1), ('account-2', 1, 1);
      INSERT INTO source_records (id, created_at, updated_at, account_id, kind)
        VALUES ('source-2', 1, 1, 'account-2', 'user_input');
      INSERT INTO conversation_sessions (
        id, created_at, updated_at, account_id, status, started_at, last_user_message_at
      ) VALUES ('session-1', 1, 1, 'account-1', 'active', 1, 1);
      INSERT INTO conversation_messages (
        id, created_at, updated_at, session_id, sequence, role, source_record_id, channel
      ) VALUES ('message-1', 1, 1, 'session-1', 1, 'user', 'source-2', 'line');
    `);

    expect(() => applyMigration(sqlite, "0013_majestic_giant_man.sql")).toThrow(
      /CHECK constraint failed/,
    );
    sqlite.close();
  });
});
