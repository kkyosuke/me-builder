import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { D1, DO } from "@me-builder/lib";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { type AccountDataTestStore, createAccountDataTestStore } from "../testing/account-data";
import { compatibilitySharePreviewCases } from "./case/compatibility-share-preview.case";
import { diagnosisAnswerCases } from "./case/diagnosis-answer.case";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const diagnosisSeed = path.join(repositoryRoot, "packages/lib/seeds/diagnoses.sql");
const timestamp = 1_785_801_600;
const e2eTimeoutMs = 30_000;

let miniflare: Miniflare;
let database: D1Database;
let accountDataStore: AccountDataTestStore;

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
        name: "あおい",
      }),
    ),
  );
}

const env = () => ({
  DB: database,
  ACCOUNT_DATA: accountDataStore.namespace,
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

async function getCompatibilitySharePreview(): Promise<Response> {
  return app.request(
    "/api/compatibility/share-preview",
    { headers: { Authorization: "Bearer known-token" } },
    env(),
  );
}

async function completeRelationshipDiagnosis(): Promise<unknown> {
  let lastBody: unknown;
  for (let index = 1; index <= 10; index += 1) {
    const id = `dq-relationship-priority-${String(index).padStart(2, "0")}`;
    const response = await putAnswer(id);
    expect(response.status).toBe(200);
    lastBody = await response.json();
  }
  return lastBody;
}

async function generateCompatibilityShareProfile(): Promise<void> {
  const accountId = "account-answer-e2e";
  const source = await DO.account.action.diary.storeLineTextSource(accountDataStore.db, {
    accountId,
    eventId: "compatibility-share-profile-e2e",
    body: "予定の見通しがあると落ち着いて動ける。",
    receivedAt: new Date(timestamp),
  });
  accountDataStore.raw
    .prepare(
      `INSERT INTO conversation_sessions (
         id, created_at, updated_at, is_deleted, account_id, status, started_at,
         last_user_message_at, conversation_policy_id, reply_opportunity_count,
         reply_count, awaiting_reply, next_sequence
       ) VALUES (?, ?, ?, 0, ?, 'closed', ?, ?, 'reflective', 0, 0, 0, 2)`,
    )
    .run("compatibility-summary-session", timestamp, timestamp, accountId, timestamp, timestamp);
  accountDataStore.raw
    .prepare(
      `INSERT INTO conversation_messages (
         id, created_at, updated_at, is_deleted, session_id, sequence, role,
         source_record_id, channel
       ) VALUES (?, ?, ?, 0, ?, 1, 'user', ?, 'line')`,
    )
    .run(
      "compatibility-summary-message",
      timestamp,
      timestamp,
      "compatibility-summary-session",
      source.sourceRecordId,
    );
  const request = await DO.account.action.profileSummary.requestProfileSummaryGeneration(
    accountDataStore.db,
    accountId,
  );
  if (request.outcome !== "created") throw new Error("profile summary generation was not created");
  const context = await DO.account.action.profileSummary.loadProfileSummaryGenerationContext(
    accountDataStore.db,
    accountId,
    request.generationId,
  );
  const evidenceId = context?.evidence[0]?.id;
  if (!context || !evidenceId) throw new Error("profile summary evidence was not available");
  await DO.account.action.profileSummary.completeProfileSummaryGeneration(
    accountDataStore.db,
    accountId,
    {
      generationId: request.generationId,
      generatedAt: new Date(timestamp + 1_000),
      model: "gemini-test",
      promptVersion: "profile-summary-v2",
      headline: "見通しを大切にしています",
      insights: [],
      compatibilityShareStatements: [
        {
          key: "planning-style",
          label: "予定の立て方",
          statement: "私は、先の見通しを持って動けると安心しやすいです",
          evidenceIds: [evidenceId],
        },
      ],
      diagnosisCount: context.diagnosisCount,
      diaryCount: context.diaryCount,
      latestRecordedAt: context.latestRecordedAt,
      inputSnapshot: context.inputSnapshot,
    },
  );
}

async function deferQuestion(
  diagnosisQuestionId: string,
  diagnosisId = "relationship-priority",
): Promise<Response> {
  return app.request(
    `/api/diagnoses/${diagnosisId}/deferred-questions/${diagnosisQuestionId}`,
    { method: "PUT", headers: { Authorization: "Bearer known-token" } },
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

async function countRows(
  table:
    | "diagnosis_responses"
    | "source_records"
    | "diagnosis_answers"
    | "diagnosis_deferred_questions",
) {
  const result = accountDataStore.raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
    | { count: number }
    | undefined;
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
    accountDataStore = createAccountDataTestStore();
    await accountDataStore.syncCatalogFrom(D1.shared.client.create(database));
    mockLineVerification();
  }, e2eTimeoutMs);

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

  it("あとで回答を冪等に保存し、同じ質問への回答時に延期を解消する", async () => {
    const responses = await Promise.all([
      deferQuestion("dq-relationship-priority-01"),
      deferQuestion("dq-relationship-priority-01"),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{
      outcome: string;
      deferredQuestion: { deferredAt: string };
    }>;
    expect(bodies.map(({ outcome }) => outcome).sort()).toEqual(["created", "unchanged"]);
    expect(
      new Set(bodies.map(({ deferredQuestion }) => deferredQuestion.deferredAt)),
    ).toHaveProperty("size", 1);
    expect(await countRows("diagnosis_deferred_questions")).toBe(1);
    expect(await countRows("diagnosis_answers")).toBe(0);
    expect(await listRelationshipDiagnosis()).toMatchObject({
      responseStatus: "unanswered",
      answeredCount: 0,
    });

    expect((await putAnswer("dq-relationship-priority-01")).status).toBe(200);
    const activeDeferred = accountDataStore.raw
      .prepare("SELECT COUNT(*) AS count FROM diagnosis_deferred_questions WHERE is_deleted = 0")
      .get() as { count: number } | undefined;
    expect(activeDeferred?.count).toBe(0);
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
    const persisted = accountDataStore.raw
      .prepare("SELECT choice_id FROM diagnosis_answers WHERE is_deleted = 0")
      .get() as { choice_id: string } | undefined;
    expect(persisted?.choice_id).toBe("yes");
    expect(await countRows("source_records")).toBe(1);
  });

  it(
    `${diagnosisAnswerCases.complete.id}: ${diagnosisAnswerCases.complete.name}`,
    async () => {
      const lastBody = await completeRelationshipDiagnosis();
      expect(lastBody).toMatchObject({
        progress: { responseStatus: "answered", answeredCount: 10, questionCount: 10 },
      });
      expect(await listRelationshipDiagnosis()).toMatchObject({
        responseStatus: "answered",
        answeredCount: 10,
      });
    },
    e2eTimeoutMs,
  );

  it(
    `${compatibilitySharePreviewCases.completedDiagnosis.id}: ${compatibilitySharePreviewCases.completedDiagnosis.name}`,
    async () => {
      const emptyResponse = await getCompatibilitySharePreview();
      expect(emptyResponse.status).toBe(200);
      expect(await emptyResponse.json()).toMatchObject({
        displayName: "あおい",
        aboutMe: null,
        themes: [],
        canIssueInvitation: false,
        blockingReasons: ["profile_summary_required", "diagnosis_required"],
        nextAction: "profile-summary",
      });

      await completeRelationshipDiagnosis();
      await generateCompatibilityShareProfile();

      const previewResponse = await getCompatibilitySharePreview();
      expect(previewResponse.status).toBe(200);
      const preview = (await previewResponse.json()) as {
        displayName: string;
        aboutMe: { statements: Array<Record<string, unknown>> } | null;
        themes: Array<{
          diagnosisId: string;
          parameters: Array<Record<string, unknown>>;
        }>;
        canIssueInvitation: boolean;
        blockingReasons: string[];
        nextAction: string | null;
        previewToken: string;
      };
      expect(preview.displayName).toBe("あおい");
      expect(preview.canIssueInvitation).toBe(true);
      expect(preview.blockingReasons).toEqual([]);
      expect(preview.nextAction).toBeNull();
      expect(preview.previewToken).toMatch(/^csp2\.[a-f0-9]{64}$/);
      expect(preview.aboutMe?.statements).toEqual([
        {
          key: "planning-style",
          label: "予定の立て方",
          statement: "私は、先の見通しを持って動けると安心しやすいです",
        },
      ]);
      expect(preview.themes).toHaveLength(1);
      expect(preview.themes[0]?.diagnosisId).toBe("relationship-priority");
      expect(preview.themes[0]?.parameters).toHaveLength(4);
      expect(preview.themes[0]?.parameters[0]).toEqual({
        id: expect.any(String),
        label: expect.any(String),
        lowLabel: expect.any(String),
        highLabel: expect.any(String),
        position: expect.any(Number),
        statement: expect.stringContaining("傾向があります"),
      });
      expect(JSON.stringify(preview)).not.toMatch(
        /choiceId|questionText|coverage|accountId|fingerprint/,
      );
    },
    e2eTimeoutMs,
  );

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

  it(
    "インドア・アウトドアと余暇の回答を4つのパラメータへ採点する",
    async () => {
      for (let index = 1; index <= 10; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const response = await putAnswer(`dq-leisure-style-${suffix}`, "yes", "leisure-style");
        expect(response.status).toBe(200);
      }

      const response = await getAnswers("leisure-style");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "leisure-style",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "状況に応じて楽しむ",
          parameters: [
            expect.objectContaining({ id: "outdoor-preference", score: 67, coverage: 100 }),
            expect.objectContaining({ id: "experience-openness", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "shared-leisure", score: 60, coverage: 100 }),
            expect.objectContaining({ id: "activity-level", score: 100, coverage: 100 }),
          ],
        },
      });
    },
    e2eTimeoutMs,
  );

  it(
    "時間と予定の回答を4つのパラメータへ採点する",
    async () => {
      for (let index = 1; index <= 10; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const response = await putAnswer(`dq-time-planning-${suffix}`, "yes", "time-planning");
        expect(response.status).toBe(200);
      }

      const response = await getAnswers("time-planning");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "time-planning",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "状況に応じて予定を決める",
          parameters: [
            expect.objectContaining({ id: "advance-planning", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "spontaneous-flexibility", score: 80, coverage: 100 }),
            expect.objectContaining({ id: "time-reliability", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "shared-time-priority", score: 100, coverage: 100 }),
          ],
        },
      });
    },
    e2eTimeoutMs,
  );

  it(
    "会話と感情表現の回答を5つのパラメータへ採点する",
    async () => {
      const highSideQuestionIndexes = new Set([1, 2, 3, 4, 6]);
      for (let index = 1; index <= 10; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const response = await putAnswer(
          `dq-conversation-emotion-${suffix}`,
          highSideQuestionIndexes.has(index) ? "yes" : "no",
          "conversation-emotion",
        );
        expect(response.status).toBe(200);
      }

      const response = await getAnswers("conversation-emotion");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "conversation-emotion",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "状況に応じて伝え方を選ぶ",
          parameters: [
            expect.objectContaining({ id: "empathetic-reception", score: 75, coverage: 100 }),
            expect.objectContaining({ id: "verbal-affection", score: 75, coverage: 100 }),
            expect.objectContaining({ id: "direct-communication", score: 75, coverage: 100 }),
            expect.objectContaining({ id: "active-support", score: 75, coverage: 100 }),
            expect.objectContaining({ id: "emotional-openness", score: 75, coverage: 100 }),
          ],
        },
      });
    },
    e2eTimeoutMs,
  );

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
      deletedBrainItemCount: 0,
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
    const orphaned = accountDataStore.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM source_records AS source
         LEFT JOIN diagnosis_answers AS answer ON answer.source_record_id = source.id
         WHERE source.account_id = ? AND source.kind = 'user_input' AND answer.id IS NULL`,
      )
      .get("account-answer-e2e") as { count: number } | undefined;
    expect(orphaned?.count ?? 0).toBe(0);
    expect(await countRows("source_records")).toBe(await countRows("diagnosis_answers"));
  });
});
