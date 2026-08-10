import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { sharedD1 } from "@me-builder/lib";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { type AccountDataTestStore, createAccountDataTestStore } from "../testing/account-data";
import { profileSummaryCases } from "./case/profile-summary.case";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const timestamp = 1_785_801_600;
const e2eSetupTimeoutMs = 90_000;

let miniflare: Miniflare;
let database: D1Database;
let accountDataStore: AccountDataTestStore;

async function applyMigrations(db: D1Database): Promise<void> {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  for (const file of migrationFiles) {
    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
  }
}

async function prepareAccount(db: D1Database): Promise<void> {
  await applyMigrations(db);
  await db.batch([
    db
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
         VALUES (?, ?, ?, 0, 'active')`,
      )
      .bind("account-summary-e2e", timestamp, timestamp),
    db
      .prepare(
        `INSERT INTO account_identities (
           id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
         ) VALUES (?, ?, ?, 0, ?, 'line_login', ?)`,
      )
      .bind(
        "identity-summary-e2e",
        timestamp,
        timestamp,
        "account-summary-e2e",
        "line-summary-e2e",
      ),
  ]);
}

function insertSourceRecord(): void {
  accountDataStore.bind("account-summary-e2e");
  accountDataStore.raw
    .prepare(
      `INSERT INTO source_records (
         id, created_at, updated_at, is_deleted, account_id, kind, access_label
       ) VALUES (?, ?, ?, 0, ?, 'user_input', 'private')`,
    )
    .run("source-summary-e2e", timestamp, timestamp, "account-summary-e2e");
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

async function request(): Promise<Response> {
  return app.request(
    "/api/profile-summary",
    { headers: { Authorization: "Bearer known-token" } },
    {
      DB: database,
      ACCOUNT_DATA: accountDataStore.namespace,
      LINE_LOGIN_CHANNEL_ID: "1234567890",
      ENVIRONMENT: "test",
    },
  );
}

describe("GET /api/profile-summary local D1 E2E", () => {
  beforeAll(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "profile-summary-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await prepareAccount(database);
    accountDataStore = createAccountDataTestStore();
    await accountDataStore.syncCatalogFrom(sharedD1.client.create(database));
  }, e2eSetupTimeoutMs);

  beforeEach(() => {
    mockLineVerification();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

  it(`${profileSummaryCases.noRecords.id}: ${profileSummaryCases.noRecords.name}`, async () => {
    const response = await request();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      versions: [],
      availableDataCounts: { diagnosis: 0, diary: 0 },
    });
  });

  it(`${profileSummaryCases.readVersions.id}: ${profileSummaryCases.readVersions.name}`, async () => {
    insertSourceRecord();

    const response = await request();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      versions: Array<{
        id: string;
        isLatest: boolean;
        summary: { headline: string };
      }>;
      availableDataCounts: { diagnosis: number; diary: number };
      generation: {
        status: string;
        canRegenerate: boolean;
        reasons: string[];
        message: string | null;
      };
    };

    expect(body.versions).toHaveLength(3);
    expect(body.versions.filter(({ isLatest }) => isLatest)).toHaveLength(1);
    expect(new Set(body.versions.map(({ summary }) => summary.headline)).size).toBe(3);
    expect(body.availableDataCounts).toEqual({ diagnosis: 3, diary: 6 });
    expect(body.generation).toEqual({
      status: "idle",
      canRegenerate: false,
      reasons: [],
      message: null,
    });
  });
});
