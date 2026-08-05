import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { diagnosisAnswerCases } from "./case/diagnosis-answer.case";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const diagnosisSeed = path.join(repositoryRoot, "packages/lib/seeds/diagnoses.sql");
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
  await applySqlFile(db, await readFile(diagnosisSeed, "utf8"));
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

async function putAnswer(
  diagnosisQuestionId: string,
  choiceId = "yes",
  diagnosisId = "relationship-priority",
): Promise<Response> {
  return app.request(
    `/api/diagnoses/${diagnosisId}/answers/${diagnosisQuestionId}`,
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

async function getAnswers(diagnosisId = "relationship-priority"): Promise<Response> {
  return app.request(
    `/api/diagnoses/${diagnosisId}/answers`,
    { headers: { Authorization: "Bearer known-token" } },
    env(),
  );
}

async function deleteDiagnosisData(environment: string | undefined): Promise<Response> {
  const { ENVIRONMENT: _, ...baseEnv } = env();
  return app.request(
    "/api/dev/diagnosis-data",
    { method: "DELETE", headers: { Authorization: "Bearer known-token" } },
    { ...baseEnv, ...(environment === undefined ? {} : { ENVIRONMENT: environment }) },
  );
}

async function listRelationshipDiagnosis(): Promise<{
  responseStatus: string;
  answeredCount: number;
}> {
  const response = await app.request(
    "/api/diagnoses",
    { headers: { Authorization: "Bearer known-token" } },
    env(),
  );
  const body = (await response.json()) as {
    diagnoses: Array<{ id: string; responseStatus: string; answeredCount: number }>;
  };
  const diagnosis = body.diagnoses.find(({ id }) => id === "relationship-priority");
  if (!diagnosis) {
    throw new Error("relationship-priorityが一覧にありません");
  }
  return diagnosis;
}

async function countRows(table: "diagnosis_responses" | "source_records" | "diagnosis_answers") {
  const result = await database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{
    count: number;
  }>();
  return result?.count ?? 0;
}

describe("PUT /api/diagnoses/:diagnosisId/answers/:diagnosisQuestionId local D1 E2E", () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "diagnosis-answer-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await prepareDatabase(database);
    mockLineVerification();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await miniflare.dispose();
  });

  it(`${diagnosisAnswerCases.createAndProgress.id}: ${diagnosisAnswerCases.createAndProgress.name}`, async () => {
    const response = await putAnswer("dq-relationship-priority-01");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: "created",
      progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
    });
    expect(await listRelationshipDiagnosis()).toMatchObject({
      responseStatus: "in-progress",
      answeredCount: 1,
    });
    expect(await countRows("diagnosis_responses")).toBe(1);
    expect(await countRows("source_records")).toBe(1);
    expect(await countRows("diagnosis_answers")).toBe(1);
  });

  it(`${diagnosisAnswerCases.idempotentRetry.id}: ${diagnosisAnswerCases.idempotentRetry.name}`, async () => {
    const responses = await Promise.all([
      putAnswer("dq-relationship-priority-01"),
      putAnswer("dq-relationship-priority-01"),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{
      outcome: string;
      answer: { acceptedAt: string };
    }>;
    expect(bodies.map(({ outcome }) => outcome).sort()).toEqual(["created", "unchanged"]);
    expect(new Set(bodies.map(({ answer }) => answer.acceptedAt))).toHaveProperty("size", 1);
    expect(await countRows("diagnosis_responses")).toBe(1);
    expect(await countRows("source_records")).toBe(1);
    expect(await countRows("diagnosis_answers")).toBe(1);
  });

  it(`${diagnosisAnswerCases.rejectChange.id}: ${diagnosisAnswerCases.rejectChange.name}`, async () => {
    await putAnswer("dq-relationship-priority-01", "yes");
    const changed = await putAnswer("dq-relationship-priority-01", "no");
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({
      error: "Answer already exists",
      reason: "answer_change_requires_revision",
    });
    const persisted = await database
      .prepare("SELECT choice_id FROM diagnosis_answers WHERE is_deleted = 0")
      .first<{ choice_id: string }>();
    expect(persisted?.choice_id).toBe("yes");
    expect(await countRows("source_records")).toBe(1);
  });

  it(`${diagnosisAnswerCases.complete.id}: ${diagnosisAnswerCases.complete.name}`, async () => {
    let lastBody: unknown;
    for (let index = 1; index <= 10; index += 1) {
      const id = `dq-relationship-priority-${String(index).padStart(2, "0")}`;
      const response = await putAnswer(id);
      expect(response.status).toBe(200);
      lastBody = await response.json();
    }
    expect(lastBody).toMatchObject({
      progress: { responseStatus: "answered", answeredCount: 10, questionCount: 10 },
    });
    expect(await listRelationshipDiagnosis()).toMatchObject({
      responseStatus: "answered",
      answeredCount: 10,
    });
  });

  it(`${diagnosisAnswerCases.getContents.id}: ${diagnosisAnswerCases.getContents.name}`, async () => {
    await putAnswer("dq-relationship-priority-01", "yes");
    await putAnswer("dq-relationship-priority-02", "no");

    const response = await getAnswers();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "relationship-priority",
      responseStatus: "in-progress",
      answeredCount: 2,
      questionCount: 10,
      answers: [
        {
          diagnosisQuestionId: "dq-relationship-priority-01",
          questionId: "q-relationship-priority-01",
          questionVersion: 1,
          choiceId: "yes",
          choiceLabel: "はい",
        },
        {
          diagnosisQuestionId: "dq-relationship-priority-02",
          choiceId: "no",
          choiceLabel: "いいえ",
        },
      ],
      scoring: {
        scoringVersion: 1,
        balancedLabel: "状況に応じて調整",
        parameters: expect.arrayContaining([
          expect.objectContaining({ id: "priority-balance", coverage: 33, score: null }),
        ]),
      },
    });
  });

  it("seedで参照される全採点設定がQuestion ID・Version・Choiceと一致する", async () => {
    const rows = await database
      .prepare(
        `SELECT
           d.id AS diagnosis_id,
           dq.id AS diagnosis_question_id,
           qc.choice_id
         FROM diagnoses AS d
         INNER JOIN diagnosis_scoring_configs AS sc
           ON sc.id = d.scoring_config_id AND sc.is_deleted = 0
         INNER JOIN diagnosis_questions AS dq
           ON dq.diagnosis_id = d.id AND dq.is_deleted = 0
         INNER JOIN question_choices AS qc
           ON qc.question_id = dq.question_id
          AND qc.question_version = dq.question_version
          AND qc.is_deleted = 0
         WHERE d.state = 'published' AND d.is_deleted = 0
         ORDER BY d.id, dq.position, qc.position`,
      )
      .all<{
        diagnosis_id: string;
        diagnosis_question_id: string;
        choice_id: string;
      }>();
    const targets = new Map<string, { diagnosisQuestionId: string; choiceId: string }>();
    for (const row of rows.results) {
      if (!targets.has(row.diagnosis_id)) {
        targets.set(row.diagnosis_id, {
          diagnosisQuestionId: row.diagnosis_question_id,
          choiceId: row.choice_id,
        });
      }
    }
    expect(targets.size).toBeGreaterThan(0);

    for (const [diagnosisId, target] of targets) {
      const saved = await putAnswer(target.diagnosisQuestionId, target.choiceId, diagnosisId);
      expect(saved.status).toBe(200);

      const response = await getAnswers(diagnosisId);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: diagnosisId,
        scoring: {
          scoringVersion: expect.any(Number),
          parameters: expect.any(Array),
        },
      });
    }
  });

  it(`${diagnosisAnswerCases.missingContents.id}: ${diagnosisAnswerCases.missingContents.name}`, async () => {
    const response = await getAnswers();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Diagnosis answers not found",
      reason: "diagnosis_answers_not_found",
    });
  });

  it(`${diagnosisAnswerCases.resetDevelopmentData.id}: ${diagnosisAnswerCases.resetDevelopmentData.name}`, async () => {
    await putAnswer("dq-relationship-priority-01", "yes");
    await putAnswer("dq-relationship-priority-02", "no");

    const response = await deleteDiagnosisData("test");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deletedResponseCount: 1,
      deletedAnswerCount: 2,
      deletedDeferredQuestionCount: 0,
      deletedSourceRecordCount: 2,
    });
    expect(await countRows("diagnosis_responses")).toBe(0);
    expect(await countRows("source_records")).toBe(0);
    expect(await countRows("diagnosis_answers")).toBe(0);
    expect(await listRelationshipDiagnosis()).toMatchObject({
      responseStatus: "unanswered",
      answeredCount: 0,
    });
  });

  it(`${diagnosisAnswerCases.rejectProductionReset.id}: ${diagnosisAnswerCases.rejectProductionReset.name}`, async () => {
    await putAnswer("dq-relationship-priority-01", "yes");

    const response = await deleteDiagnosisData("production");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not Found" });
    expect(await countRows("diagnosis_responses")).toBe(1);
    expect(await countRows("source_records")).toBe(1);
    expect(await countRows("diagnosis_answers")).toBe(1);
  });

  it(`${diagnosisAnswerCases.rejectUnconfiguredReset.id}: ${diagnosisAnswerCases.rejectUnconfiguredReset.name}`, async () => {
    await putAnswer("dq-relationship-priority-01", "yes");

    const response = await deleteDiagnosisData(undefined);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not Found" });
    expect(await countRows("diagnosis_responses")).toBe(1);
    expect(await countRows("source_records")).toBe(1);
    expect(await countRows("diagnosis_answers")).toBe(1);
  });

  it(`${diagnosisAnswerCases.concurrentSaveAndReset.id}: ${diagnosisAnswerCases.concurrentSaveAndReset.name}`, async () => {
    await putAnswer("dq-relationship-priority-01", "yes");

    const [saved, reset] = await Promise.all([
      putAnswer("dq-relationship-priority-02", "no"),
      deleteDiagnosisData("test"),
    ]);

    expect(saved.status).toBe(200);
    expect(reset.status).toBe(200);
    const orphaned = await database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM source_records AS source
         LEFT JOIN diagnosis_answers AS answer ON answer.source_record_id = source.id
         WHERE source.account_id = ? AND source.kind = 'user_input' AND answer.id IS NULL`,
      )
      .bind("account-answer-e2e")
      .first<{ count: number }>();
    expect(orphaned?.count ?? 0).toBe(0);
    expect(await countRows("source_records")).toBe(await countRows("diagnosis_answers"));
  });
});
