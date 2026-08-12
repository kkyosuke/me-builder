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
});
