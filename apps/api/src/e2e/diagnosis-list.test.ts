import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { diagnosisDetailCases } from "./case/diagnosis-detail.case";
import { diagnosisListCases } from "./case/diagnosis-list.case";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const diagnosisSeed = path.join(repositoryRoot, "packages/lib/seeds/diagnoses.sql");
const timestamp = 1_785_801_600;

let miniflare: Miniflare;
let database: D1Database;

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

    for (const statement of statements) {
      await db.prepare(statement).run();
    }
  }
}

async function applySeed(db: D1Database, sql: string): Promise<void> {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

async function prepareDatabase(db: D1Database): Promise<void> {
  await applyMigrations(db);

  const seed = await readFile(diagnosisSeed, "utf8");
  await applySeed(db, seed);
  // 運営が表示順を変更した場合も、seedの再実行で正式値へ戻ることを確認する。
  await db.prepare("UPDATE diagnoses SET display_order = 999").run();
  await applySeed(db, seed);

  await db
    .prepare(
      `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
       VALUES (?, ?, ?, 0, 'active')`,
    )
    .bind("account-e2e", timestamp, timestamp)
    .run();
  await db
    .prepare(
      `INSERT INTO account_identities (
         id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
       ) VALUES (?, ?, ?, 0, ?, 'line_login', ?)`,
    )
    .bind("identity-e2e", timestamp, timestamp, "account-e2e", "line-user-e2e")
    .run();
}

function mockLineVerification(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init?.body?.toString());
      const idToken = body.get("id_token");
      if (idToken === "invalid-token") {
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }
      const sub = idToken === "known-token" ? "line-user-e2e" : "unknown-line-user";

      return Response.json({
        iss: "https://access.line.me",
        sub,
        aud: "1234567890",
        exp: timestamp + 86_400,
      });
    }),
  );
}

async function insertAnswers(
  db: D1Database,
  diagnosisId: string,
  responseId: string,
  answerLimit: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO diagnosis_responses (
         id, created_at, updated_at, is_deleted, account_id, diagnosis_id
       ) VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .bind(responseId, timestamp, timestamp, "account-e2e", diagnosisId)
    .run();

  const questions = await db
    .prepare(
      `SELECT id, question_id, question_version
       FROM diagnosis_questions
       WHERE diagnosis_id = ? AND is_deleted = 0
       ORDER BY position
       LIMIT ?`,
    )
    .bind(diagnosisId, answerLimit)
    .all<{ id: string; question_id: string; question_version: number }>();

  for (const [index, question] of questions.results.entries()) {
    const sourceRecordId = `source-${responseId}-${index}`;
    await db.batch([
      db
        .prepare(
          `INSERT INTO source_records (
             id, created_at, updated_at, is_deleted, account_id, kind, access_label
           ) VALUES (?, ?, ?, 0, ?, 'user_input', 'private')`,
        )
        .bind(sourceRecordId, timestamp, timestamp, "account-e2e"),
      db
        .prepare(
          `INSERT INTO diagnosis_answers (
             id, created_at, updated_at, is_deleted, account_id, diagnosis_response_id,
             diagnosis_question_id, question_id, question_version, choice_id,
             accepted_at, source_record_id
           ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 'yes', ?, ?)`,
        )
        .bind(
          `answer-${responseId}-${index}`,
          timestamp,
          timestamp,
          "account-e2e",
          responseId,
          question.id,
          question.question_id,
          question.question_version,
          timestamp,
          sourceRecordId,
        ),
    ]);
  }
}

async function request(idToken?: string, path = "/api/diagnoses"): Promise<Response> {
  const init: RequestInit = idToken ? { headers: { Authorization: `Bearer ${idToken}` } } : {};

  return await app.request(path, init, {
    DB: database,
    LINE_LOGIN_CHANNEL_ID: "1234567890",
    ENVIRONMENT: "test",
  });
}

describe("GET /api/diagnoses local D1 E2E", () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "diagnosis-list-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await prepareDatabase(database);
    mockLineVerification();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await miniflare.dispose();
  });

  it(`${diagnosisListCases.progress.id}: ${diagnosisListCases.progress.name}`, async () => {
    const initialResponse = await request("known-token");
    expect(initialResponse.status).toBe(200);

    const initialBody = (await initialResponse.json()) as {
      diagnoses: Array<{
        id: string;
        description: string;
        displayOrder: number;
        responseStatus: string;
        answeredCount: number;
        questionCount: number;
        lastAnsweredAt: string | null;
      }>;
    };
    expect(initialBody.diagnoses).toHaveLength(4);
    expect(initialBody.diagnoses.map(({ displayOrder }) => displayOrder)).toEqual([10, 20, 30, 40]);
    expect(initialBody.diagnoses.every(({ description }) => description.length > 0)).toBe(true);
    expect(
      initialBody.diagnoses.every(({ responseStatus }) => responseStatus === "unanswered"),
    ).toBe(true);

    await insertAnswers(database, "money-values", "response-money", 1);
    await insertAnswers(database, "relationship-priority", "response-relationship", 10);

    const progressedResponse = await request("known-token");
    expect(progressedResponse.status).toBe(200);
    const progressedBody = (await progressedResponse.json()) as {
      diagnoses: Array<{
        id: string;
        responseStatus: string;
        answeredCount: number;
        questionCount: number;
        lastAnsweredAt: string | null;
      }>;
    };

    expect(progressedBody.diagnoses.find(({ id }) => id === "money-values")).toMatchObject({
      responseStatus: "in-progress",
      answeredCount: 1,
      questionCount: 10,
      lastAnsweredAt: expect.any(String),
    });
    expect(progressedBody.diagnoses.find(({ id }) => id === "relationship-priority")).toMatchObject(
      {
        responseStatus: "answered",
        answeredCount: 10,
        questionCount: 10,
        lastAnsweredAt: expect.any(String),
      },
    );
  });

  it(`${diagnosisListCases.missingAuthorization.id}: ${diagnosisListCases.missingAuthorization.name}`, async () => {
    const response = await request();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it(`${diagnosisListCases.invalidToken.id}: ${diagnosisListCases.invalidToken.name}`, async () => {
    const response = await request("invalid-token");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it(`${diagnosisListCases.accountNotFound.id}: ${diagnosisListCases.accountNotFound.name}`, async () => {
    const response = await request("unknown-token");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Account not found",
      reason: "friendship_required",
    });
  });
});

describe("GET /api/diagnoses/:diagnosisId local D1 E2E", () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "diagnosis-detail-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await prepareDatabase(database);
    mockLineVerification();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await miniflare.dispose();
  });

  it(`${diagnosisDetailCases.available.id}: ${diagnosisDetailCases.available.name}`, async () => {
    const response = await request("known-token", "/api/diagnoses/relationship-priority");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      questions: Array<{
        diagnosisQuestionId: string;
        questionVersion: number;
        choices: Array<{ choiceId: string; label: string }>;
      }>;
    };
    expect(body.id).toBe("relationship-priority");
    expect(body.questions).toHaveLength(10);
    expect(body.questions[0]).toMatchObject({
      diagnosisQuestionId: "dq-relationship-priority-01",
      questionVersion: 1,
      choices: [
        { choiceId: "no", label: "いいえ" },
        { choiceId: "yes", label: "はい" },
      ],
    });
  });

  it("インドア・アウトドアと余暇の10問をseedから返すこと", async () => {
    const response = await request("known-token", "/api/diagnoses/leisure-style");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      title: string;
      questions: Array<{ diagnosisQuestionId: string; text: string }>;
    };

    expect(body).toMatchObject({
      id: "leisure-style",
      title: "インドア・アウトドアと余暇",
    });
    expect(body.questions).toHaveLength(10);
    expect(body.questions[0]).toMatchObject({
      diagnosisQuestionId: "dq-leisure-style-01",
      text: "予定のない休日は、家で過ごすより外へ出たい。",
    });
  });

  it("時間と予定の10問をseedから返すこと", async () => {
    const response = await request("known-token", "/api/diagnoses/time-planning");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      title: string;
      questions: Array<{ diagnosisQuestionId: string; text: string }>;
    };

    expect(body).toMatchObject({ id: "time-planning", title: "時間と予定" });
    expect(body.questions).toHaveLength(10);
    expect(body.questions[0]).toMatchObject({
      diagnosisQuestionId: "dq-time-planning-01",
      text: "休日の予定は、前日までに決めておきたい。",
    });
  });

  it(`${diagnosisDetailCases.notFound.id}: ${diagnosisDetailCases.notFound.name}`, async () => {
    const missing = await request("known-token", "/api/diagnoses/missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "Diagnosis not found",
      reason: "diagnosis_not_found",
    });
  });

  it(`${diagnosisDetailCases.closed.id}: ${diagnosisDetailCases.closed.name}`, async () => {
    await database
      .prepare("UPDATE diagnoses SET closes_at = ? WHERE id = ?")
      .bind(timestamp, "relationship-priority")
      .run();
    const closed = await request("known-token", "/api/diagnoses/relationship-priority");
    expect(closed.status).toBe(409);
    expect(await closed.json()).toEqual({ error: "Diagnosis closed", reason: "diagnosis_closed" });
  });
});
