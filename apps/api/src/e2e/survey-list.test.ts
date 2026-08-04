import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const questionnaireSeed = path.join(repositoryRoot, "packages/lib/seeds/questionnaires.sql");
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

  const seed = await readFile(questionnaireSeed, "utf8");
  await applySeed(db, seed);
  // seedの再実行でも同じ初期状態を維持できることをE2Eの前提として確認する。
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
  surveyId: string,
  responseId: string,
  answerLimit: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO survey_responses (
         id, created_at, updated_at, is_deleted, account_id, survey_id
       ) VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .bind(responseId, timestamp, timestamp, "account-e2e", surveyId)
    .run();

  const questions = await db
    .prepare(
      `SELECT id, question_id, question_version
       FROM survey_questions
       WHERE survey_id = ? AND is_deleted = 0
       ORDER BY position
       LIMIT ?`,
    )
    .bind(surveyId, answerLimit)
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
          `INSERT INTO survey_answers (
             id, created_at, updated_at, is_deleted, survey_response_id,
             survey_question_id, question_id, question_version, choice_id,
             accepted_at, source_record_id
           ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'yes', ?, ?)`,
        )
        .bind(
          `answer-${responseId}-${index}`,
          timestamp,
          timestamp,
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

async function request(idToken?: string, path = "/api/surveys"): Promise<Response> {
  const init: RequestInit = idToken ? { headers: { Authorization: `Bearer ${idToken}` } } : {};

  return await app.request(path, init, {
    DB: database,
    LINE_LOGIN_CHANNEL_ID: "1234567890",
    ENVIRONMENT: "test",
  });
}

describe("GET /api/surveys local D1 E2E", () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "survey-list-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await prepareDatabase(database);
    mockLineVerification();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await miniflare.dispose();
  });

  it("migrationとseedからAccount別の回答進捗を返すこと", async () => {
    const initialResponse = await request("known-token");
    expect(initialResponse.status).toBe(200);

    const initialBody = (await initialResponse.json()) as {
      surveys: Array<{
        id: string;
        description: string;
        responseStatus: string;
        answeredCount: number;
        questionCount: number;
      }>;
    };
    expect(initialBody.surveys).toHaveLength(2);
    expect(initialBody.surveys.every(({ description }) => description.length > 0)).toBe(true);
    expect(initialBody.surveys.every(({ responseStatus }) => responseStatus === "unanswered")).toBe(
      true,
    );

    await insertAnswers(database, "money-values", "response-money", 1);
    await insertAnswers(database, "relationship-priority", "response-relationship", 10);

    const progressedResponse = await request("known-token");
    expect(progressedResponse.status).toBe(200);
    const progressedBody = (await progressedResponse.json()) as {
      surveys: Array<{
        id: string;
        responseStatus: string;
        answeredCount: number;
        questionCount: number;
      }>;
    };

    expect(progressedBody.surveys.find(({ id }) => id === "money-values")).toMatchObject({
      responseStatus: "in-progress",
      answeredCount: 1,
      questionCount: 10,
    });
    expect(progressedBody.surveys.find(({ id }) => id === "relationship-priority")).toMatchObject({
      responseStatus: "answered",
      answeredCount: 10,
      questionCount: 10,
    });
  });

  it("Bearerトークンが無い場合は401を返すこと", async () => {
    const response = await request();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("LINEがIDトークンを検証できない場合は401を返すこと", async () => {
    const response = await request("invalid-token");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("検証済みの本人に対応するAccountが無い場合は404を返すこと", async () => {
    const response = await request("unknown-token");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Account not found",
      reason: "friendship_required",
    });
  });
});

describe("GET /api/surveys/:surveyId local D1 E2E", () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "survey-detail-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await prepareDatabase(database);
    mockLineVerification();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await miniflare.dispose();
  });

  it("seedのSurveyからQuestion VersionとChoiceを位置順に返す", async () => {
    const response = await request("known-token", "/api/surveys/relationship-priority");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      questions: Array<{
        surveyQuestionId: string;
        questionVersion: number;
        choices: Array<{ choiceId: string; presentation: { icon: string } }>;
      }>;
    };
    expect(body.id).toBe("relationship-priority");
    expect(body.questions).toHaveLength(10);
    expect(body.questions[0]).toMatchObject({
      surveyQuestionId: "sq-relationship-priority-01",
      questionVersion: 1,
      choices: [
        { choiceId: "no", presentation: { icon: "circle-x" } },
        { choiceId: "yes", presentation: { icon: "circle-check" } },
      ],
    });
  });

  it("存在しないSurveyを404、受付終了したSurveyを409にする", async () => {
    const missing = await request("known-token", "/api/surveys/missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "Survey not found",
      reason: "survey_not_found",
    });

    await database
      .prepare("UPDATE surveys SET closes_at = ? WHERE id = ?")
      .bind(timestamp, "relationship-priority")
      .run();
    const closed = await request("known-token", "/api/surveys/relationship-priority");
    expect(closed.status).toBe(409);
    expect(await closed.json()).toEqual({ error: "Survey closed", reason: "survey_closed" });
  });
});
