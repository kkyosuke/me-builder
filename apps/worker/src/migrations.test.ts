import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

// AccountDataのtable定義はpackages/libが所有するため、migrationも同じ場所にある。
const MIGRATION_DIRECTORIES = [
  path.resolve(__dirname, "../../../packages/lib/drizzle-do-account"),
  path.resolve(__dirname, "../drizzle/compatibility-data"),
  path.resolve(__dirname, "../drizzle/conversation-coordinator"),
];

describe("Durable Object clean baseline migrations", () => {
  it.each(MIGRATION_DIRECTORIES)("%sは0000から連番で持つ", (directory) => {
    const files = readdirSync(directory)
      .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
      .sort();
    expect(files[0]).toMatch(/^0000_.+\.sql$/);
    expect(files.map((filename) => filename.slice(0, 4))).toEqual(
      files.map((_, index) => index.toString().padStart(4, "0")),
    );
  });

  it("CompatibilityDataの既存関係をプロフィール同意列の追加後も保持する", () => {
    const directory = MIGRATION_DIRECTORIES[1];
    if (!directory) throw new Error("CompatibilityData migration directory is missing");
    const files = readdirSync(directory)
      .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
      .sort();
    const database = new Database(":memory:");
    const apply = (filename: string) => {
      for (const statement of readFileSync(path.join(directory, filename), "utf8")
        .split("--> statement-breakpoint")
        .map((sql) => sql.trim())
        .filter(Boolean)) {
        database.exec(statement);
      }
    };
    const baseline = files[0];
    const upgrade = files[1];
    if (!baseline || !upgrade) throw new Error("CompatibilityData migrations are incomplete");
    apply(baseline);
    database
      .prepare(
        `INSERT INTO compatibility_relationships (
          singleton, relationship_id, inviter_account_id, invitee_account_id,
          inviter_display_name, invitee_display_name, status, expires_at, accepted_at,
          created_at, updated_at
        ) VALUES (1, ?, 'account-a', 'account-b', 'A', 'B', 'accepted', ?, ?, ?, ?)`,
      )
      .run("1".repeat(64), Date.now() + 86_400_000, Date.now(), Date.now(), Date.now());
    apply(upgrade);

    expect(
      database
        .prepare(
          `SELECT status, offered_profile_fingerprint, accepted_profile_fingerprint
           FROM compatibility_relationships`,
        )
        .get(),
    ).toEqual({
      status: "accepted",
      offered_profile_fingerprint: null,
      accepted_profile_fingerprint: null,
    });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  it("AccountDataの未反映Brainだけを進行度pendingへ引き継ぐ", () => {
    const directory = MIGRATION_DIRECTORIES[0];
    if (!directory) throw new Error("AccountData migration directory is missing");
    const files = readdirSync(directory)
      .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
      .sort();
    const database = new Database(":memory:");
    const apply = (filename: string) => {
      for (const statement of readFileSync(path.join(directory, filename), "utf8")
        .split("--> statement-breakpoint")
        .map((sql) => sql.trim())
        .filter(Boolean)) {
        database.exec(statement);
      }
    };
    for (const filename of files.slice(0, 17)) apply(filename);
    database.exec(`
      INSERT INTO account_data_identity (singleton, account_id) VALUES (1, 'account-1');
      INSERT INTO source_records
        (id, created_at, updated_at, is_deleted, account_id, kind, access_label)
      VALUES
        ('source-1', 1, 1, false, 'account-1', 'user_input', 'private'),
        ('source-2', 2, 2, false, 'account-1', 'user_input', 'private');
      INSERT INTO brain_items
        (id, created_at, updated_at, is_deleted, account_id, category, statement,
         attributes_json, derivation, status, stability, sensitivity, externally_shareable,
         confidence_json)
      VALUES
        ('item-1', 1, 1, false, 'account-1', 'preference', 'coffee', '{}',
         'deterministic', 'active', 'changeable', 'normal', false, '{}');
      INSERT INTO brain_item_evidence_edges
        (id, created_at, updated_at, is_deleted, brain_item_id, source_record_id, relation,
         is_derivation_trigger, derivation_method, generated_at)
      VALUES
        ('edge-1', 1, 1, false, 'item-1', 'source-1', 'supports', true, 'deterministic', 1),
        ('edge-2', 2, 2, false, 'item-1', 'source-2', 'supports', false, 'deterministic', 2);
      INSERT INTO progression_events
        (id, created_at, updated_at, is_deleted, account_id, origin_type, origin_id, kind,
         growth_delta, collected_piece_delta)
      VALUES
        ('progression:v1:brain_item:item-1', 1, 1, false, 'account-1', 'brain_item',
         'item-1', 'new_item', 3, 1),
        ('progression:v1:evidence:edge-1', 1, 1, false, 'account-1', 'evidence',
         'edge-1', 'evidence_added', 0, 0),
        ('progression:v1:initialization:progression-v1', 1, 1, false, 'account-1',
         'initialization', 'progression-v1', 'initialization', 0, 0);
    `);

    const upgrade = files[17];
    if (!upgrade) throw new Error("Progression state migration is missing");
    apply(upgrade);

    expect(
      database.prepare("SELECT growth_value, collected_pieces FROM progression_states").get(),
    ).toEqual({ growth_value: 3, collected_pieces: 1 });
    expect(
      database
        .prepare("SELECT brain_item_id, recognized_evidence_count FROM progression_item_states")
        .all(),
    ).toEqual([{ brain_item_id: "item-1", recognized_evidence_count: 1 }]);
    expect(
      database
        .prepare("SELECT origin_type, origin_id FROM progression_pending_events ORDER BY id")
        .all(),
    ).toEqual([{ origin_type: "evidence", origin_id: "edge-2" }]);
  });
});
