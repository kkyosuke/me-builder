import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { surveyAnswerCases } from "./survey-answer.case";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const questionnaireSeed = path.join(repositoryRoot, "packages/lib/seeds/questionnaires.sql");
const timestamp = 1_785_801_600;

let miniflare: Miniflare;
let database: D1Database;

async function applySqlFile(db: D1Database, sql: string): Promise<void> {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

async function prepareDatabase(db: D1Database): Promise<void> {
  const migrations = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of migrations) {
    await applySqlFile(db, await readFile(path.join(migrationsDirectory, file), "utf8"));
  }
  await applySqlFile(db, await readFile(questionnaireSeed, "utf8"));
  await db
    .prepare(
      `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
       VALUES (?, ?, ?, 0, 'active')`,
    )
    .bind("account-answer-e2e", timestamp, timestamp)
    .run();
  await db
    .prepare(
      `INSERT INTO account_identities (
         id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
       ) VALUES (?, ?, ?, 0, ?, 'line_login', ?)`,
    )
    .bind("identity-answer-e2e", timestamp, timestamp, "account-answer-e2e", "line-answer-e2e")
    .run();
}

function mockLineVerification(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        iss: "https://access.line.me",
        sub: "line-answer-e2e",
        aud: "1234567890",
        exp: timestamp + 86_400,
      }),
    ),
  );
}

const env = () => ({
  DB: database,
  LINE_LOGIN_CHANNEL_ID: "1234567890",
  ENVIRONMENT: "test",
});

async function putAnswer(surveyQuestionId: string, choiceId = "yes"): Promise<Response> {
  return app.request(
    `/api/surveys/relationship-priority/answers/${surveyQuestionId}`,
    {
      method: "PUT",
      headers: {
        Authorization: "Bearer known-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ choiceId }),
    },
    env(),
  );
}

async function listRelationshipSurvey(): Promise<{
  responseStatus: string;
  answeredCount: number;
}> {
  const response = await app.request(
    "/api/surveys",
    { headers: { Authorization: "Bearer known-token" } },
    env(),
  );
  const body = (await response.json()) as {
    surveys: Array<{ id: string; responseStatus: string; answeredCount: number }>;
  };
  const survey = body.surveys.find(({ id }) => id === "relationship-priority");
  if (!survey) {
    throw new Error("relationship-priorityが一覧にありません");
  }
  return survey;
}

async function countRows(table: "survey_responses" | "source_records" | "survey_answers") {
  const result = await database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{
    count: number;
  }>();
  return result?.count ?? 0;
}

describe("PUT /api/surveys/:surveyId/answers/:surveyQuestionId local D1 E2E", () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "survey-answer-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await prepareDatabase(database);
    mockLineVerification();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await miniflare.dispose();
  });

  it(`${surveyAnswerCases.createAndProgress.id}: ${surveyAnswerCases.createAndProgress.name}`, async () => {
    const response = await putAnswer("sq-relationship-priority-01");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: "created",
      progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
    });
    expect(await listRelationshipSurvey()).toMatchObject({
      responseStatus: "in-progress",
      answeredCount: 1,
    });
    expect(await countRows("survey_responses")).toBe(1);
    expect(await countRows("source_records")).toBe(1);
    expect(await countRows("survey_answers")).toBe(1);
  });

  it(`${surveyAnswerCases.idempotentRetry.id}: ${surveyAnswerCases.idempotentRetry.name}`, async () => {
    const responses = await Promise.all([
      putAnswer("sq-relationship-priority-01"),
      putAnswer("sq-relationship-priority-01"),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{
      outcome: string;
      answer: { acceptedAt: string };
    }>;
    expect(bodies.map(({ outcome }) => outcome).sort()).toEqual(["created", "unchanged"]);
    expect(new Set(bodies.map(({ answer }) => answer.acceptedAt))).toHaveProperty("size", 1);
    expect(await countRows("survey_responses")).toBe(1);
    expect(await countRows("source_records")).toBe(1);
    expect(await countRows("survey_answers")).toBe(1);
  });

  it(`${surveyAnswerCases.rejectChange.id}: ${surveyAnswerCases.rejectChange.name}`, async () => {
    await putAnswer("sq-relationship-priority-01", "yes");
    const changed = await putAnswer("sq-relationship-priority-01", "no");
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({
      error: "Answer already exists",
      reason: "answer_change_requires_revision",
    });
    const persisted = await database
      .prepare("SELECT choice_id FROM survey_answers WHERE is_deleted = 0")
      .first<{ choice_id: string }>();
    expect(persisted?.choice_id).toBe("yes");
    expect(await countRows("source_records")).toBe(1);
  });

  it(`${surveyAnswerCases.complete.id}: ${surveyAnswerCases.complete.name}`, async () => {
    let lastBody: unknown;
    for (let index = 1; index <= 10; index += 1) {
      const id = `sq-relationship-priority-${String(index).padStart(2, "0")}`;
      const response = await putAnswer(id);
      expect(response.status).toBe(200);
      lastBody = await response.json();
    }
    expect(lastBody).toMatchObject({
      progress: { responseStatus: "answered", answeredCount: 10, questionCount: 10 },
    });
    expect(await listRelationshipSurvey()).toMatchObject({
      responseStatus: "answered",
      answeredCount: 10,
    });
  });
});
