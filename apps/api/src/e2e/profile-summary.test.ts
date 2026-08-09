import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { d1 } from "@me-builder/lib";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { createD1AccountDataTestNamespace } from "../testing/account-data";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const timestamp = Date.UTC(2026, 7, 9, 0, 0, 0) / 1000;

let miniflare: Miniflare;
let database: D1Database;

async function applyMigrations(db: D1Database): Promise<void> {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  for (const file of migrationFiles) {
    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

async function prepareAccountAndDiaryMemory(db: D1Database): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
         VALUES ('account-summary-e2e', ?, ?, 0, 'active')`,
      )
      .bind(timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO account_identities (
           id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
         ) VALUES ('identity-summary-e2e', ?, ?, 0, 'account-summary-e2e', 'line_login', 'line-summary-e2e')`,
      )
      .bind(timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO source_records (
           id, created_at, updated_at, is_deleted, account_id, kind, access_label, original_ref
         ) VALUES ('source-diary-e2e', ?, ?, 0, 'account-summary-e2e', 'user_input', 'private', 'line:event-summary-e2e')`,
      )
      .bind(timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO brain_items (
           id, created_at, updated_at, is_deleted, account_id, category, statement,
           attributes_json, derivation, status, valid_from, stability, sensitivity,
           externally_shareable, confidence_json
         ) VALUES (
           'memory-diary-e2e', ?, ?, 0, 'account-summary-e2e', 'memory',
           '公開予定を一週間延期した', '{"sourceKind":"diary","isInference":false}',
           'ai', 'active', ?, 'stable', 'normal', 0, '{"state":"uncomputed"}'
         )`,
      )
      .bind(timestamp + 60, timestamp + 60, timestamp),
    db
      .prepare(
        `INSERT INTO brain_item_evidence_edges (
           id, created_at, updated_at, is_deleted, account_id, brain_item_id,
           source_record_id, relation, is_derivation_trigger, derivation_method, generated_at
         ) VALUES (
           'evidence-diary-e2e', ?, ?, 0, 'account-summary-e2e', 'memory-diary-e2e',
           'source-diary-e2e', 'supports', 1, 'ai', ?
         )`,
      )
      .bind(timestamp + 60, timestamp + 60, timestamp + 60),
    db
      .prepare(
        `INSERT INTO brain_item_access_labels (
           id, created_at, updated_at, is_deleted, account_id, brain_item_id, label, assigned_by
         ) VALUES (
           'access-diary-e2e', ?, ?, 0, 'account-summary-e2e', 'memory-diary-e2e',
           'unclassified', 'system'
         )`,
      )
      .bind(timestamp + 60, timestamp + 60),
    db
      .prepare(
        `INSERT INTO brain_item_topic_labels (
           id, created_at, updated_at, is_deleted, account_id, brain_item_id, label
         ) VALUES (
           'topic-diary-e2e', ?, ?, 0, 'account-summary-e2e', 'memory-diary-e2e', 'diary'
         )`,
      )
      .bind(timestamp + 60, timestamp + 60),
  ]);
}

function mockLineVerification(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        iss: "https://access.line.me",
        sub: "line-summary-e2e",
        aud: "1234567890",
        exp: timestamp + 86_400,
      }),
    ),
  );
}

describe("GET /api/profile-summary local D1 E2E", () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "profile-summary-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await applyMigrations(database);
    await prepareAccountAndDiaryMemory(database);
    mockLineVerification();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await miniflare.dispose();
  });

  it("AI生成済みの日記Memoryを本人のサマリーへ取り込む", async () => {
    const response = await app.request(
      "/api/profile-summary",
      { headers: { Authorization: "Bearer known-token" } },
      {
        DB: database,
        ACCOUNT_DATA: createD1AccountDataTestNamespace(d1.client.create(database)),
        LINE_LOGIN_CHANNEL_ID: "1234567890",
        ENVIRONMENT: "test",
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      summary: {
        headline: "日記から、最近の出来事を振り返れます",
        insights: [],
        themes: [],
        diaryMemories: [
          {
            id: "memory-diary-e2e",
            statement: "公開予定を一週間延期した",
            recordedAt: "2026-08-09T00:00:00.000Z",
            evidenceCount: 1,
          },
        ],
        recordCount: 0,
        diagnosisCount: 0,
        diaryCount: 1,
        latestRecordedAt: "2026-08-09T00:00:00.000Z",
      },
      nextAction: null,
    });
  });
});
