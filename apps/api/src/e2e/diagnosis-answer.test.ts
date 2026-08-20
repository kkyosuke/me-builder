import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { D1, DO } from "@me-builder/lib";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../index";
import { type AccountDataTestStore, createAccountDataTestStore } from "../testing/account-data";
import { createApplicationSessionFixture } from "../testing/application-session";
import {
  type CompatibilityDataTestStore,
  createCompatibilityDataTestStore,
} from "../testing/compatibility-data";
import { compatibilityShareCases } from "./case/compatibility-share.case";
import { diagnosisAnswerCases } from "./case/diagnosis-answer.case";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const diagnosisSeed = path.join(repositoryRoot, "packages/lib/seeds/diagnoses.sql");
const timestamp = 1_785_801_600;
const e2eTimeoutMs = 30_000;

let miniflare: Miniflare;
let database: D1Database;
let accountDataStore: AccountDataTestStore;
let compatibilityDataStore: CompatibilityDataTestStore;
let sessionFixture: ReturnType<typeof createApplicationSessionFixture>;
let sessionHeaders: Record<string, string>;

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
  await D1.shared.action.agreement.acceptCurrentTerms(
    D1.shared.client.create(db),
    "account-answer-e2e",
  );
}

const env = () => ({
  DB: database,
  ACCOUNT_DATA: accountDataStore.namespace,
  COMPATIBILITY_DATA: compatibilityDataStore.namespace,
  CONVERSATION_COORDINATOR: {
    getByName: () => ({ resetAccountData: async () => 1 }),
  },
  ...sessionFixture.bindings,
  ENVIRONMENT: "test",
  LIFF_ID: "1234567890-testliff",
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
        ...sessionHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ choiceId }),
    },
    env(),
  );
}

async function getAnswers(diagnosisId = "relationship-priority"): Promise<Response> {
  return app.request(`/api/diagnoses/${diagnosisId}/answers`, { headers: sessionHeaders }, env());
}

async function personalDataRequest(
  pathname = "/api/personal-data/records",
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
): Promise<Response> {
  return app.request(
    pathname,
    {
      method,
      headers: {
        ...sessionHeaders,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env(),
  );
}

async function getCompatibilityShareConsent(): Promise<Response> {
  return app.request("/api/compatibility/share-consent", { headers: sessionHeaders }, env());
}

async function issueCompatibilityInvitation(): Promise<Response> {
  return app.request(
    "/api/compatibility/invitations",
    {
      method: "POST",
      headers: {
        ...sessionHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ relationshipCategory: "partner" }),
    },
    env(),
  );
}

async function getDetail(diagnosisId = "relationship-priority"): Promise<Response> {
  return app.request(`/api/diagnoses/${diagnosisId}`, { headers: sessionHeaders }, env());
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

async function withdrawDiagnosis(diagnosisId = "relationship-priority"): Promise<void> {
  await database
    .prepare("UPDATE diagnoses SET state = 'withdrawn', withdrawn_at = ? WHERE id = ?")
    .bind(timestamp, diagnosisId)
    .run();
  accountDataStore.raw
    .prepare("UPDATE diagnoses SET state = 'withdrawn', withdrawn_at = ? WHERE id = ?")
    .run(timestamp, diagnosisId);
}

async function deferQuestion(
  diagnosisQuestionId: string,
  diagnosisId = "relationship-priority",
): Promise<Response> {
  return app.request(
    `/api/diagnoses/${diagnosisId}/deferred-questions/${diagnosisQuestionId}`,
    { method: "PUT", headers: sessionHeaders },
    env(),
  );
}

async function deleteAccountData(environment: string | undefined): Promise<Response> {
  await database
    .prepare("UPDATE accounts SET role = 'admin' WHERE id = ?")
    .bind("account-answer-e2e")
    .run();
  sessionHeaders = (
    await sessionFixture.issue("account-answer-e2e", { displayName: "あおい" }, new Date())
  ).headers;
  const { ENVIRONMENT: _, ...baseEnv } = env();
  return app.request(
    "/api/dev/account-data",
    {
      method: "DELETE",
      headers: { ...sessionHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    },
    { ...baseEnv, ...(environment === undefined ? {} : { ENVIRONMENT: environment }) },
  );
}

async function listRelationshipDiagnosis(): Promise<{
  responseStatus: string;
  answeredCount: number;
}> {
  const response = await app.request("/api/diagnoses", { headers: sessionHeaders }, env());
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
    | "diagnosis_deferred_questions"
    | "conversation_sessions"
    | "profile_summary_versions"
    | "brain_items"
    | "brain_vector_entries"
    | "brain_vector_sync_jobs",
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
    compatibilityDataStore = createCompatibilityDataTestStore();
    await accountDataStore.syncCatalogFrom(D1.shared.client.create(database));
    sessionFixture = createApplicationSessionFixture(database);
    sessionHeaders = (await sessionFixture.issue("account-answer-e2e", { displayName: "あおい" }))
      .headers;
  }, e2eTimeoutMs);

  afterEach(async () => {
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

  it("課金情報なしで診断回答と日記を訂正・削除し、現在一覧へ収束させる", async () => {
    expect((await putAnswer("dq-relationship-priority-01", "yes")).status).toBe(200);
    const diagnosisListResponse = await personalDataRequest();
    expect(diagnosisListResponse.status).toBe(200);
    const diagnosisList = (await diagnosisListResponse.json()) as {
      records: Array<{ id: string; kind: string; value: string }>;
    };
    const diagnosisRecord = diagnosisList.records.find(({ kind }) => kind === "diagnosis");
    expect(diagnosisRecord).toMatchObject({ value: "はい" });
    if (!diagnosisRecord) throw new Error("訂正対象の診断回答がありません");

    const diagnosisCorrection = await personalDataRequest(
      `/api/personal-data/records/${diagnosisRecord.id}`,
      "PATCH",
      { kind: "diagnosis", choiceId: "no" },
    );
    expect(diagnosisCorrection.status).toBe(200);
    const diagnosisCorrectionBody = (await diagnosisCorrection.json()) as {
      outcome: string;
      recordId: string;
    };
    expect(diagnosisCorrectionBody).toMatchObject({ outcome: "updated" });
    expect(diagnosisCorrectionBody.recordId).not.toBe(diagnosisRecord.id);

    const diagnosisDeletion = await personalDataRequest(
      `/api/personal-data/records/${diagnosisCorrectionBody.recordId}`,
      "DELETE",
    );
    expect(diagnosisDeletion.status).toBe(200);
    expect(await diagnosisDeletion.json()).toMatchObject({ outcome: "deleted" });

    const diaryAt = new Date(timestamp + 10_000);
    const diarySource = await DO.account.action.diary.storeLineTextSource(accountDataStore.db, {
      accountId: "account-answer-e2e",
      eventId: "personal-data-diary-e2e",
      body: "訂正前の日記",
      receivedAt: diaryAt,
    });
    accountDataStore.raw
      .prepare(
        `INSERT INTO conversation_sessions (
           id, created_at, updated_at, is_deleted, account_id, status, started_at,
           last_user_message_at, conversation_policy_id, reply_opportunity_count,
           reply_count, awaiting_reply, next_sequence
         ) VALUES (?, ?, ?, 0, ?, 'closed', ?, ?, 'reflective', 0, 0, 0, 2)`,
      )
      .run(
        "personal-data-session",
        diaryAt.getTime(),
        diaryAt.getTime(),
        "account-answer-e2e",
        diaryAt.getTime(),
        diaryAt.getTime(),
      );
    accountDataStore.raw
      .prepare(
        `INSERT INTO conversation_messages (
           id, created_at, updated_at, is_deleted, session_id, sequence, role,
           source_record_id, channel
         ) VALUES (?, ?, ?, 0, ?, 1, 'user', ?, 'line')`,
      )
      .run(
        "personal-data-message",
        diaryAt.getTime(),
        diaryAt.getTime(),
        "personal-data-session",
        diarySource.sourceRecordId,
      );

    const diaryCorrection = await personalDataRequest(
      `/api/personal-data/records/${diarySource.sourceRecordId}`,
      "PATCH",
      { kind: "diary", value: "訂正後の日記" },
    );
    expect(diaryCorrection.status).toBe(200);
    const diaryCorrectionBody = (await diaryCorrection.json()) as {
      outcome: string;
      recordId: string;
    };
    expect(diaryCorrectionBody).toMatchObject({ outcome: "updated" });

    const currentResponse = await personalDataRequest();
    const current = (await currentResponse.json()) as {
      records: Array<{ id: string; kind: string; value: string }>;
    };
    expect(current.records).toEqual([
      expect.objectContaining({
        id: diaryCorrectionBody.recordId,
        kind: "diary",
        value: "訂正後の日記",
      }),
    ]);

    const diaryDeletion = await personalDataRequest(
      `/api/personal-data/records/${diaryCorrectionBody.recordId}`,
      "DELETE",
    );
    expect(diaryDeletion.status).toBe(200);
    expect(await personalDataRequest().then((response) => response.json())).toEqual({
      records: [],
    });
    const oldDiaryBody = accountDataStore.raw
      .prepare("SELECT body FROM source_record_text_payloads WHERE source_record_id = ?")
      .get(diarySource.sourceRecordId) as { body: string } | undefined;
    expect(oldDiaryBody?.body).toBe("訂正前の日記");
  });

  it("Free相当でも本文を含まない本人特徴だけをAPIで取得する", async () => {
    const accountId = "account-answer-e2e";
    accountDataStore.bind(accountId);
    const source = await DO.account.action.diary.storeLineTextSource(accountDataStore.db, {
      accountId,
      eventId: "private-line-event-must-not-export",
      body: "APIへ持ち出してはいけない本人の日記",
      receivedAt: new Date(timestamp + 20_000),
    });
    await accountDataStore.db.insert(DO.account.schema.compatibilityReferences).values({
      relationshipId: "relationship-must-not-export",
      accountId,
      role: "invitee",
      partnerAccountId: "partner-account-must-not-export",
      status: "active",
      createdAt: new Date(timestamp + 20_000),
      updatedAt: new Date(timestamp + 20_000),
    });
    await accountDataStore.db.insert(DO.account.schema.brainItems).values({
      id: "brain-item-must-not-export",
      accountId,
      category: "preference",
      statement: "APIへ持ち出してはいけない命題",
      attributes: { trait: "reflective" },
      derivation: "ai",
      status: "active",
      stability: "changeable",
      sensitivity: "normal",
      confidence: { state: "uncomputed" },
    });
    await accountDataStore.db.insert(DO.account.schema.brainItemEvidenceEdges).values({
      id: "evidence-must-not-export",
      brainItemId: "brain-item-must-not-export",
      sourceRecordId: source.sourceRecordId,
      relation: "supports",
      isDerivationTrigger: true,
      derivationMethod: "ai",
      generatedAt: new Date(timestamp + 20_000),
    });

    const response = await personalDataRequest("/api/personal-data/features");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const features = await response.text();
    expect(features).toContain('"trait":"reflective"');
    expect(features).not.toMatch(
      /relationship-must-not-export|partner-account-must-not-export|private-line-event-must-not-export|stripe|customerId|priceId|paymentMethod/,
    );
    expect(features).not.toMatch(
      /APIへ持ち出してはいけない|brain-item-must-not-export|evidence-must-not-export|sourceRecordId/,
    );
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
    `${compatibilityShareCases.completedDiagnosis.id}: ${compatibilityShareCases.completedDiagnosis.name}`,
    async () => {
      const emptyResponse = await getCompatibilityShareConsent();
      expect(emptyResponse.status).toBe(200);
      expect(await emptyResponse.json()).toEqual({
        displayName: "あおい",
        avatarUrl: "/api/profile/avatar",
        canShare: true,
        blockingReasons: [],
        nextAction: "profile-summary",
      });

      await completeRelationshipDiagnosis();
      await generateCompatibilityShareProfile();

      const consentResponse = await getCompatibilityShareConsent();
      expect(consentResponse.status).toBe(200);
      const consent = await consentResponse.json();
      expect(consent).toEqual({
        displayName: "あおい",
        avatarUrl: "/api/profile/avatar",
        canShare: true,
        blockingReasons: [],
        nextAction: null,
      });
      expect(JSON.stringify(consent)).not.toMatch(
        /aboutMe|themes|previewToken|statement|choiceId|questionText|coverage|accountId|fingerprint/,
      );
    },
    e2eTimeoutMs,
  );

  it(
    `${compatibilityShareCases.issueInvitation.id}: ${compatibilityShareCases.issueInvitation.name}`,
    async () => {
      const issueResponse = await issueCompatibilityInvitation();
      expect(issueResponse.status).toBe(201);
      const invitation = (await issueResponse.json()) as {
        invitationUrl: string;
        expiresAt: string;
      };
      expect(invitation.invitationUrl).toMatch(
        /^https:\/\/liff\.line\.me\/1234567890-testliff\/compatibility\/invitations\/[a-f0-9]{64}$/,
      );
      expect(new Date(invitation.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(compatibilityDataStore.relationships.size).toBe(1);
      expect(
        accountDataStore.raw.prepare("SELECT status FROM compatibility_references").get(),
      ).toEqual({ status: "pending" });
    },
    e2eTimeoutMs,
  );

  it(`${diagnosisAnswerCases.getContents.id}: 保存済み回答を返し、回答途中は採点しないこと`, async () => {
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
      scoring: null,
    });
  });

  it(
    "seedで参照される全Question ID・Version・Choiceへ回答を保存でき、途中結果を採点しない",
    async () => {
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
          scoring: null,
        });
      }
    },
    e2eTimeoutMs,
  );

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

  it(
    "優先順位と人生の方向性の回答を5つのパラメータへ採点する",
    async () => {
      for (let index = 1; index <= 10; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const response = await putAnswer(`dq-life-priorities-${suffix}`, "yes", "life-priorities");
        expect(response.status).toBe(200);
      }

      const response = await getAnswers("life-priorities");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "life-priorities",
        relationshipCategory: "general",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "状況に応じて優先するものを選ぶ",
          parameters: [
            expect.objectContaining({ id: "challenge-orientation", score: 60, coverage: 100 }),
            expect.objectContaining({
              id: "self-directed-fulfillment",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "close-relationship-priority",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({ id: "personal-wellbeing", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "future-stability", score: 100, coverage: 100 }),
          ],
        },
      });
    },
    e2eTimeoutMs,
  );

  it(
    "仕事の価値観・働き方の回答を5つのパラメータへ採点する",
    async () => {
      for (let index = 1; index <= 10; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const response = await putAnswer(`dq-work-values-${suffix}`, "yes", "work-values");
        expect(response.status).toBe(200);
      }

      const response = await getAnswers("work-values");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "work-values",
        relationshipCategory: "general",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "状況に応じて働き方を選ぶ",
          parameters: [
            expect.objectContaining({ id: "work-autonomy", score: 50, coverage: 100 }),
            expect.objectContaining({ id: "growth-orientation", score: 40, coverage: 100 }),
            expect.objectContaining({ id: "compensation-priority", score: 80, coverage: 100 }),
            expect.objectContaining({ id: "work-stability", score: 75, coverage: 100 }),
            expect.objectContaining({ id: "work-life-boundary", score: 67, coverage: 100 }),
          ],
        },
      });
    },
    e2eTimeoutMs,
  );

  it(
    "仕事の変化・周囲との関わり方の回答を5つのパラメータへ採点する",
    async () => {
      for (let index = 1; index <= 10; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const choiceId = index % 2 === 1 ? "yes" : "no";
        const response = await putAnswer(
          `dq-work-relationship-style-${suffix}`,
          choiceId,
          "work-relationship-style",
        );
        expect(response.status).toBe(200);
      }

      const response = await getAnswers("work-relationship-style");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "work-relationship-style",
        relationshipCategory: "work",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "状況に応じて仕事での関わり方を選ぶ",
          parameters: [
            expect.objectContaining({ id: "work-novelty", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "workplace-closeness", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "workplace-autonomy", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "workplace-feedback", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "workplace-openness", score: 100, coverage: 100 }),
          ],
        },
      });
    },
    e2eTimeoutMs,
  );

  it(
    "家族との距離感・支え合いの回答を5つのパラメータへ採点する",
    async () => {
      for (let index = 1; index <= 10; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const choiceId = index % 2 === 1 ? "yes" : "no";
        const response = await putAnswer(
          `dq-family-support-style-${suffix}`,
          choiceId,
          "family-support-style",
        );
        expect(response.status).toBe(200);
      }

      const response = await getAnswers("family-support-style");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "family-support-style",
        relationshipCategory: "family",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "状況に応じて家族との関わり方を選ぶ",
          parameters: [
            expect.objectContaining({
              id: "family-contact",
              label: "会えない時期の連絡",
              lowLabel: "用事があるときに連絡したい",
              highLabel: "会えない時期も定期的に連絡したい",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({ id: "family-disclosure", score: 100, coverage: 100 }),
            expect.objectContaining({
              id: "family-support-approach",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "family-conflict-timing",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({ id: "family-planning", score: 100, coverage: 100 }),
          ],
        },
      });
    },
    e2eTimeoutMs,
  );

  it(
    "友達との距離感・付き合い方の回答を5つのパラメータへ採点する",
    async () => {
      for (let index = 1; index <= 10; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const choiceId = index % 2 === 1 ? "yes" : "no";
        const response = await putAnswer(
          `dq-friendship-style-${suffix}`,
          choiceId,
          "friendship-style",
        );
        expect(response.status).toBe(200);
      }

      const response = await getAnswers("friendship-style");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "friendship-style",
        relationshipCategory: "friend",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "状況に応じて友達との付き合い方を選ぶ",
          parameters: [
            expect.objectContaining({ id: "friend-contact", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "friend-planning", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "friend-disclosure", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "friend-circle", score: 100, coverage: 100 }),
            expect.objectContaining({
              id: "friend-conflict-timing",
              score: 100,
              coverage: 100,
            }),
          ],
        },
      });
    },
    e2eTimeoutMs,
  );

  it(
    "決め方・迷いとの向き合い方の回答を5つのパラメータへ採点する",
    async () => {
      for (let index = 1; index <= 10; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const choiceId = index % 2 === 1 ? "yes" : "no";
        const response = await putAnswer(
          `dq-decision-making-style-${suffix}`,
          choiceId,
          "decision-making-style",
        );
        expect(response.status).toBe(200);
      }

      const response = await getAnswers("decision-making-style");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "decision-making-style",
        relationshipCategory: "general",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "状況に応じて決め方を使い分ける",
          parameters: [
            expect.objectContaining({ id: "decision-information", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "decision-timing", score: 100, coverage: 100 }),
            expect.objectContaining({ id: "decision-intuition", score: 100, coverage: 100 }),
            expect.objectContaining({
              id: "decision-consultation",
              label: "相談の取り入れ方",
              lowLabel: "まず自分の考えを固めたい",
              highLabel: "まず意見を聞きたい",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "decision-reconsideration",
              score: 100,
              coverage: 100,
            }),
          ],
        },
      });
    },
    e2eTimeoutMs,
  );

  it(
    "仕事の進め方・優先順位の回答を5つのパラメータへ採点する",
    async () => {
      for (let index = 1; index <= 10; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const choiceId = index % 2 === 1 ? "yes" : "no";
        const response = await putAnswer(
          `dq-work-priority-style-${suffix}`,
          choiceId,
          "work-priority-style",
        );
        expect(response.status).toBe(200);
      }

      const response = await getAnswers("work-priority-style");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "work-priority-style",
        relationshipCategory: "work",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "状況に応じて仕事の進め方を選ぶ",
          parameters: [
            expect.objectContaining({
              id: "work-completion-depth",
              label: "仕上げの区切り",
              lowLabel: "細部を整えてから進みたい",
              highLabel: "必要十分で次へ進みたい",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "work-task-parallelism",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "work-deadline-use",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "work-reprioritization",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "work-progress-sharing",
              score: 100,
              coverage: 100,
            }),
          ],
        },
      });
    },
    e2eTimeoutMs,
  );

  it(
    "家族の期待と自分の選択の回答を5つのパラメータへ採点する",
    async () => {
      for (let index = 1; index <= 10; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const choiceId = index % 2 === 1 ? "yes" : "no";
        const response = await putAnswer(
          `dq-family-expectation-choice-${suffix}`,
          choiceId,
          "family-expectation-choice",
        );
        expect(response.status).toBe(200);
      }

      const response = await getAnswers("family-expectation-choice");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "family-expectation-choice",
        relationshipCategory: "family",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "選択に応じて家族の意向を取り入れる",
          parameters: [
            expect.objectContaining({
              id: "family-choice-consultation",
              label: "大きな選択の相談",
              lowLabel: "自分の考えを固めてから話したい",
              highLabel: "早い段階で家族に相談したい",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "family-career-direction",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "family-work-change-agreement",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "family-partnership-agreement",
              label: "結婚の選択",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "family-residence-priority",
              score: 100,
              coverage: 100,
            }),
          ],
        },
      });
    },
    e2eTimeoutMs,
  );

  it(
    "友達との信頼・秘密・境界線の回答を5つのパラメータへ採点する",
    async () => {
      for (let index = 1; index <= 10; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const choiceId = index % 2 === 1 ? "yes" : "no";
        const response = await putAnswer(
          `dq-friend-trust-boundaries-${suffix}`,
          choiceId,
          "friend-trust-boundaries",
        );
        expect(response.status).toBe(200);
      }

      const response = await getAnswers("friend-trust-boundaries");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "friend-trust-boundaries",
        relationshipCategory: "friend",
        scoring: {
          scoringVersion: 1,
          balancedLabel: "状況に応じて友達との境界を調整する",
          parameters: [
            expect.objectContaining({
              id: "friend-private-story-sharing",
              label: "個人的な話の共有",
              lowLabel: "共有範囲を状況で判断したい",
              highLabel: "本人に確認してから共有したい",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "friend-advice-permission",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "friend-photo-consent",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "friend-promise-change-notice",
              score: 100,
              coverage: 100,
            }),
            expect.objectContaining({
              id: "friend-boundary-response",
              score: 100,
              coverage: 100,
            }),
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

  it("回答済みならwithdrawn後も一覧・詳細・回答内容を取得できる", async () => {
    for (let index = 1; index <= 10; index += 1) {
      const questionId = `dq-relationship-priority-${String(index).padStart(2, "0")}`;
      expect((await putAnswer(questionId, "yes")).status).toBe(200);
    }
    await withdrawDiagnosis();

    const listItem = await listRelationshipDiagnosis();
    expect(listItem).toMatchObject({ responseStatus: "answered", answeredCount: 10 });

    const detail = await getDetail();
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: "relationship-priority" });

    const answers = await getAnswers();
    expect(answers.status).toBe(200);
    const answersBody = (await answers.json()) as {
      id: string;
      responseStatus: string;
      answeredCount: number;
      answers: Array<{ diagnosisQuestionId: string; choiceId: string }>;
    };
    expect(answersBody).toMatchObject({
      id: "relationship-priority",
      responseStatus: "answered",
      answeredCount: 10,
    });
    expect(answersBody.answers).toHaveLength(10);
    expect(answersBody.answers[0]).toMatchObject({
      diagnosisQuestionId: "dq-relationship-priority-01",
      choiceId: "yes",
    });
  });

  it("未回答ならwithdrawnの一覧・詳細・回答内容を公開しない", async () => {
    await withdrawDiagnosis();

    const list = await app.request("/api/diagnoses", { headers: sessionHeaders }, env());
    const listBody = (await list.json()) as { diagnoses: Array<{ id: string }> };
    expect(listBody.diagnoses.some(({ id }) => id === "relationship-priority")).toBe(false);

    const detail = await getDetail();
    expect(detail.status).toBe(404);
    expect(await detail.json()).toEqual({
      error: "Diagnosis not found",
      reason: "diagnosis_not_found",
    });

    const answers = await getAnswers();
    expect(answers.status).toBe(404);
    expect(await answers.json()).toEqual({
      error: "Diagnosis answers not found",
      reason: "diagnosis_answers_not_found",
    });
  });

  it("withdrawnでは既存Responseがあっても新規回答保存・延期を拒否する", async () => {
    await putAnswer("dq-relationship-priority-01", "yes");
    await withdrawDiagnosis();

    const answer = await putAnswer("dq-relationship-priority-02", "no");
    expect(answer.status).toBe(404);
    expect(await answer.json()).toEqual({
      error: "Diagnosis not found",
      reason: "diagnosis_not_found",
    });

    const deferred = await deferQuestion("dq-relationship-priority-02");
    expect(deferred.status).toBe(404);
    expect(await deferred.json()).toEqual({
      error: "Diagnosis not found",
      reason: "diagnosis_not_found",
    });
    expect(await countRows("diagnosis_answers")).toBe(1);
    expect(await countRows("diagnosis_deferred_questions")).toBe(0);
  });

  it(`${diagnosisAnswerCases.resetDevelopmentData.id}: ${diagnosisAnswerCases.resetDevelopmentData.name}`, async () => {
    await putAnswer("dq-relationship-priority-01", "yes");
    await putAnswer("dq-relationship-priority-02", "no");
    await generateCompatibilityShareProfile();
    accountDataStore.raw
      .prepare(
        `INSERT INTO brain_items (
           id, created_at, updated_at, is_deleted, account_id, category, statement,
           attributes_json, derivation, status, stability, sensitivity,
           externally_shareable, confidence_json
         ) VALUES (?, ?, ?, 0, ?, 'memory', 'テスト用記憶', '{}', 'ai', 'active',
           'changeable', 'normal', 0, '{}')`,
      )
      .run("reset-brain-item", timestamp, timestamp, "account-answer-e2e");
    accountDataStore.raw
      .prepare(
        `INSERT INTO brain_vector_entries (
           id, created_at, updated_at, is_deleted, brain_item_id, item_revision
         ) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run("reset-vector", timestamp, timestamp, "reset-brain-item", timestamp);

    const response = await deleteAccountData("test");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deletedDiagnosisResponseCount: 1,
      deletedConversationSessionCount: 1,
      deletedSourceRecordCount: 3,
      deletedBrainItemCount: 1,
      deletedProfileSummaryVersionCount: 1,
      scheduledVectorDeletionCount: 1,
    });
    expect(await countRows("diagnosis_responses")).toBe(0);
    expect(await countRows("source_records")).toBe(0);
    expect(await countRows("diagnosis_answers")).toBe(0);
    expect(await countRows("conversation_sessions")).toBe(0);
    expect(await countRows("profile_summary_versions")).toBe(0);
    expect(await countRows("brain_items")).toBe(0);
    expect(await countRows("brain_vector_entries")).toBe(1);
    expect(await countRows("brain_vector_sync_jobs")).toBe(1);
    expect(await listRelationshipDiagnosis()).toMatchObject({
      responseStatus: "unanswered",
      answeredCount: 0,
    });
  });

  it(`${diagnosisAnswerCases.rejectProductionReset.id}: ${diagnosisAnswerCases.rejectProductionReset.name}`, async () => {
    await putAnswer("dq-relationship-priority-01", "yes");

    const response = await deleteAccountData("production");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not Found" });
    expect(await countRows("diagnosis_responses")).toBe(1);
    expect(await countRows("source_records")).toBe(1);
    expect(await countRows("diagnosis_answers")).toBe(1);
  });

  it(`${diagnosisAnswerCases.rejectUnconfiguredReset.id}: ${diagnosisAnswerCases.rejectUnconfiguredReset.name}`, async () => {
    await putAnswer("dq-relationship-priority-01", "yes");

    const response = await deleteAccountData(undefined);

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
      deleteAccountData("test"),
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
