import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { D1 } from "@me-builder/lib";
import { currentServiceTerms } from "@me-builder/shared";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../index";
import { type AccountDataTestStore, createAccountDataTestStore } from "../testing/account-data";
import { createApplicationSessionFixture } from "../testing/application-session";
import { diagnosisDetailCases } from "./case/diagnosis-detail.case";
import { diagnosisListCases } from "./case/diagnosis-list.case";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const diagnosisSeed = path.join(repositoryRoot, "packages/lib/seeds/diagnoses.sql");
const timestamp = 1_785_801_600;
const e2eSetupTimeoutMs = 30_000;

let miniflare: Miniflare;
let database: D1Database;
let accountDataStore: AccountDataTestStore;
let sessionFixture: ReturnType<typeof createApplicationSessionFixture>;
let knownSessionHeaders: Record<string, string>;
let unknownSessionHeaders: Record<string, string>;

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
  // 運営が表示順を変更した場合と、migrationの初期値generalが残る場合に、
  // seedの再実行で正式な公開定義へ戻ることを確認する。
  await db
    .prepare(
      `UPDATE diagnoses
       SET display_order = 999,
           relationship_category = CASE
             WHEN id IN (
               'relationship-priority',
               'money-values',
               'leisure-style',
               'time-planning',
               'conversation-emotion'
             ) THEN 'general'
             ELSE relationship_category
           END`,
    )
    .run();
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
  await db.batch([
    db
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
         VALUES (?, ?, ?, 0, 'active')`,
      )
      .bind("account-unknown-e2e", timestamp + 1, timestamp + 1),
    db
      .prepare(
        `INSERT INTO account_identities (
           id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
         ) VALUES (?, ?, ?, 0, ?, 'line_login', ?)`,
      )
      .bind(
        "identity-unknown-e2e",
        timestamp + 1,
        timestamp + 1,
        "account-unknown-e2e",
        "unknown-line-user",
      ),
  ]);
  await D1.shared.action.agreement.acceptCurrentTerms(D1.shared.client.create(db), "account-e2e");
}

function authenticationHeaders(credential?: string): HeadersInit | undefined {
  if (credential === "known-token") return knownSessionHeaders;
  if (credential === "unknown-token") return unknownSessionHeaders;
  if (credential === "bearer-only") return { Authorization: "Bearer legacy-token" };
  return undefined;
}

async function insertAnswers(
  db: D1Database,
  diagnosisId: string,
  responseId: string,
  answerLimit: number,
): Promise<void> {
  const owned = accountDataStore.raw;
  accountDataStore.bind("account-e2e");
  owned
    .prepare(
      `INSERT INTO diagnosis_responses (
         id, created_at, updated_at, is_deleted, account_id, diagnosis_id
       ) VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .run(responseId, timestamp, timestamp, "account-e2e", diagnosisId);

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
    owned
      .prepare(
        `INSERT INTO source_records (
           id, created_at, updated_at, is_deleted, account_id, kind, access_label
         ) VALUES (?, ?, ?, 0, ?, 'user_input', 'private')`,
      )
      .run(sourceRecordId, timestamp, timestamp, "account-e2e");
    owned
      .prepare(
        `INSERT INTO diagnosis_answers (
           id, created_at, updated_at, is_deleted, diagnosis_response_id,
           diagnosis_question_id, question_id, question_version, choice_id,
           accepted_at, source_record_id
         ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'yes', ?, ?)`,
      )
      .run(
        `answer-${responseId}-${index}`,
        timestamp,
        timestamp,
        responseId,
        question.id,
        question.question_id,
        question.question_version,
        timestamp,
        sourceRecordId,
      );
  }
}

async function request(idToken?: string, path = "/api/diagnoses"): Promise<Response> {
  const headers = authenticationHeaders(idToken);

  return await app.request(path, headers ? { headers } : {}, {
    DB: database,
    ACCOUNT_DATA: accountDataStore.namespace,
    ...sessionFixture.bindings,
    ENVIRONMENT: "test",
  });
}

async function requestLegal(idToken: string, path = "/api/legal/terms", init?: RequestInit) {
  const headers = new Headers(authenticationHeaders(idToken));
  for (const [name, value] of new Headers(init?.headers)) headers.set(name, value);
  return await app.request(
    path,
    {
      ...init,
      headers,
    },
    {
      DB: database,
      ...sessionFixture.bindings,
      ENVIRONMENT: "test",
    },
  );
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
    accountDataStore = createAccountDataTestStore();
    await accountDataStore.syncCatalogFrom(D1.shared.client.create(database));
    sessionFixture = createApplicationSessionFixture(database);
    knownSessionHeaders = (await sessionFixture.issue("account-e2e")).headers;
    unknownSessionHeaders = (await sessionFixture.issue("account-unknown-e2e")).headers;
  }, e2eSetupTimeoutMs);

  afterEach(async () => {
    await miniflare.dispose();
  });

  it(`${diagnosisListCases.progress.id}: ${diagnosisListCases.progress.name}`, async () => {
    const initialResponse = await request("known-token");
    expect(initialResponse.status).toBe(200);

    const initialBody = (await initialResponse.json()) as {
      diagnoses: Array<{
        id: string;
        relationshipCategory: string;
        description: string;
        displayOrder: number;
        responseStatus: string;
        answeredCount: number;
        questionCount: number;
        lastAnsweredAt: string | null;
      }>;
    };
    expect(initialBody.diagnoses).toHaveLength(14);
    expect(initialBody.diagnoses.map(({ displayOrder }) => displayOrder)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140,
    ]);
    expect(initialBody.diagnoses.find(({ id }) => id === "life-priorities")).toMatchObject({
      relationshipCategory: "general",
      responseStatus: "unanswered",
      questionCount: 10,
    });
    expect(initialBody.diagnoses.find(({ id }) => id === "work-values")).toMatchObject({
      relationshipCategory: "general",
      responseStatus: "unanswered",
      questionCount: 10,
    });
    expect(initialBody.diagnoses.find(({ id }) => id === "work-relationship-style")).toMatchObject({
      relationshipCategory: "work",
      responseStatus: "unanswered",
      questionCount: 10,
    });
    expect(initialBody.diagnoses.find(({ id }) => id === "family-support-style")).toMatchObject({
      relationshipCategory: "family",
      responseStatus: "unanswered",
      questionCount: 10,
    });
    expect(initialBody.diagnoses.find(({ id }) => id === "friendship-style")).toMatchObject({
      relationshipCategory: "friend",
      responseStatus: "unanswered",
      questionCount: 10,
    });
    expect(initialBody.diagnoses.find(({ id }) => id === "decision-making-style")).toMatchObject({
      relationshipCategory: "general",
      responseStatus: "unanswered",
      questionCount: 10,
    });
    expect(initialBody.diagnoses.find(({ id }) => id === "work-priority-style")).toMatchObject({
      relationshipCategory: "work",
      responseStatus: "unanswered",
      questionCount: 10,
    });
    expect(
      initialBody.diagnoses.find(({ id }) => id === "family-expectation-choice"),
    ).toMatchObject({
      relationshipCategory: "family",
      responseStatus: "unanswered",
      questionCount: 10,
    });
    expect(initialBody.diagnoses.find(({ id }) => id === "friend-trust-boundaries")).toMatchObject({
      relationshipCategory: "friend",
      responseStatus: "unanswered",
      questionCount: 10,
    });
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
      relationshipCategory: "partner",
      responseStatus: "in-progress",
      answeredCount: 1,
      questionCount: 10,
      lastAnsweredAt: expect.any(String),
    });
    expect(progressedBody.diagnoses.find(({ id }) => id === "relationship-priority")).toMatchObject(
      {
        relationshipCategory: "partner",
        responseStatus: "answered",
        answeredCount: 10,
        questionCount: 10,
        lastAnsweredAt: expect.any(String),
      },
    );
  });

  it(`${diagnosisListCases.missingSession.id}: ${diagnosisListCases.missingSession.name}`, async () => {
    const response = await request();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it(`${diagnosisListCases.bearerRejected.id}: ${diagnosisListCases.bearerRejected.name}`, async () => {
    const response = await request("bearer-only");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it.each([
    {
      name: "重要改定前の旧version",
      version: "2026-01-01",
      hash: `sha256:${"1".repeat(64)}`,
      isDeleted: 0,
    },
    {
      name: "本文hashが一致しない記録",
      version: currentServiceTerms.version,
      hash: `sha256:${"2".repeat(64)}`,
      isDeleted: 0,
    },
    {
      name: "削除済みの記録",
      version: currentServiceTerms.version,
      hash: currentServiceTerms.contentHash,
      isDeleted: 1,
    },
  ])("$nameでは規約取得だけを許可し、本人機能を428にする", async (acceptance) => {
    await database
      .prepare(
        `UPDATE account_agreement_acceptances
         SET document_version = ?, document_hash = ?, is_deleted = ?
         WHERE account_id = ?`,
      )
      .bind(acceptance.version, acceptance.hash, acceptance.isDeleted, "account-e2e")
      .run();

    const terms = await requestLegal("known-token");
    expect(terms.status).toBe(200);
    expect(await terms.json()).toMatchObject({
      acceptance: {
        required: true,
        acceptedVersion: null,
        documentHash: null,
        acceptedAt: null,
      },
    });

    const feature = await request("known-token");
    expect(feature.status).toBe(428);
    expect(await feature.json()).toEqual({
      error: "Terms acceptance required",
      reason: "terms_not_accepted",
    });
  });

  it("同じversionへの再同意を冪等に扱い、最初の同意証跡を返す", async () => {
    const before = await database
      .prepare(
        `SELECT accepted_at AS acceptedAt
         FROM account_agreement_acceptances
         WHERE account_id = ? AND is_deleted = 0`,
      )
      .bind("account-e2e")
      .first<{ acceptedAt: string }>();

    const response = await requestLegal("known-token", "/api/legal/terms/acceptance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: currentServiceTerms.version }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      version: currentServiceTerms.version,
      documentHash: currentServiceTerms.contentHash,
      acceptedAt: before?.acceptedAt,
    });
    const count = await database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM account_agreement_acceptances
         WHERE account_id = ?`,
      )
      .bind("account-e2e")
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("削除済みの同じversionへ再同意し、新しい有効な証跡で本人機能を再開する", async () => {
    await database
      .prepare(
        `UPDATE account_agreement_acceptances
         SET is_deleted = 1, deleted_at = ?, updated_at = ?
         WHERE account_id = ?`,
      )
      .bind(timestamp + 1, timestamp + 1, "account-e2e")
      .run();

    const response = await requestLegal("known-token", "/api/legal/terms/acceptance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: currentServiceTerms.version }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      version: currentServiceTerms.version,
      documentHash: currentServiceTerms.contentHash,
    });
    const histories = await database
      .prepare(
        `SELECT id, is_deleted AS isDeleted
         FROM account_agreement_acceptances
         WHERE account_id = ?`,
      )
      .bind("account-e2e")
      .all<{ id: string; isDeleted: number }>();
    expect(histories.results).toHaveLength(2);
    expect(histories.results.filter((acceptance) => acceptance.isDeleted === 0)).toHaveLength(1);
    expect(histories.results.filter((acceptance) => acceptance.isDeleted === 1)).toHaveLength(1);
    expect(new Set(histories.results.map((acceptance) => acceptance.id)).size).toBe(2);

    const historyResponse = await requestLegal("known-token", "/api/legal/terms/acceptances");
    expect(historyResponse.status).toBe(200);
    expect(await historyResponse.json()).toMatchObject({
      acceptances: [
        { version: currentServiceTerms.version, status: "current" },
        { version: currentServiceTerms.version, status: "past" },
      ],
    });

    const feature = await request("known-token");
    expect(feature.status).toBe(200);
  });

  it("表示後にversionが変わった同意要求を409にし、履歴を追加しない", async () => {
    const response = await requestLegal("known-token", "/api/legal/terms/acceptance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "2026-01-01" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Terms version is no longer current",
      currentVersion: currentServiceTerms.version,
    });
    const count = await database
      .prepare("SELECT COUNT(*) AS count FROM account_agreement_acceptances")
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it(`${diagnosisListCases.webFirstAccountCreation.id}: ${diagnosisListCases.webFirstAccountCreation.name}`, async () => {
    const beforeAcceptance = await request("unknown-token");
    expect(beforeAcceptance.status).toBe(428);
    expect(await beforeAcceptance.json()).toEqual({
      error: "Terms acceptance required",
      reason: "terms_not_accepted",
    });
    const acceptance = await app.request(
      "/api/legal/terms/acceptance",
      {
        method: "PUT",
        headers: {
          ...unknownSessionHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version: currentServiceTerms.version }),
      },
      {
        DB: database,
        ...sessionFixture.bindings,
        ENVIRONMENT: "test",
      },
    );
    expect(acceptance.status).toBe(200);

    const response = await request("unknown-token");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      diagnoses: Array<{ responseStatus: string; answeredCount: number }>;
    };
    expect(body.diagnoses).toHaveLength(14);
    expect(body.diagnoses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ responseStatus: "unanswered", answeredCount: 0 }),
      ]),
    );

    const created = await database
      .prepare(
        `SELECT a.id, i.provider
         FROM accounts a
         INNER JOIN account_identities i ON i.account_id = a.id
         WHERE i.provider_account_id = ? AND a.is_deleted = 0 AND i.is_deleted = 0`,
      )
      .bind("unknown-line-user")
      .all<{ id: string; provider: string }>();
    expect(created.results).toEqual([expect.objectContaining({ provider: "line_login" })]);
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
    accountDataStore = createAccountDataTestStore();
    await accountDataStore.syncCatalogFrom(D1.shared.client.create(database));
    sessionFixture = createApplicationSessionFixture(database);
    knownSessionHeaders = (await sessionFixture.issue("account-e2e")).headers;
    unknownSessionHeaders = (await sessionFixture.issue("account-unknown-e2e")).headers;
  }, e2eSetupTimeoutMs);

  afterEach(async () => {
    await miniflare.dispose();
  });

  it(`${diagnosisDetailCases.available.id}: ${diagnosisDetailCases.available.name}`, async () => {
    const response = await request("known-token", "/api/diagnoses/relationship-priority");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      relationshipCategory: string;
      questions: Array<{
        diagnosisQuestionId: string;
        questionVersion: number;
        format: "single_choice" | "likert_5";
        choices: Array<{ choiceId: string; label: string; score: number | null }>;
      }>;
    };
    expect(body.id).toBe("relationship-priority");
    expect(body.relationshipCategory).toBe("partner");
    expect(body.questions).toHaveLength(10);
    expect(body.questions[0]).toMatchObject({
      diagnosisQuestionId: "dq-relationship-priority-01",
      questionVersion: 1,
      choices: [
        { choiceId: "no", label: "いいえ", score: null },
        { choiceId: "yes", label: "はい", score: null },
      ],
      format: "single_choice",
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

  it("仕事の変化・周囲との関わり方の状況ベース10問をseedから返すこと", async () => {
    const response = await request("known-token", "/api/diagnoses/work-relationship-style");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      title: string;
      relationshipCategory: string;
      questions: Array<{ diagnosisQuestionId: string; text: string }>;
    };

    expect(body).toMatchObject({
      id: "work-relationship-style",
      title: "仕事の変化・周囲との関わり方",
      relationshipCategory: "work",
    });
    expect(body.questions.map(({ text }) => text)).toEqual([
      "慣れた仕事と新しい仕事を選べる場面では、新しい役割や課題に取り組みたい。",
      "慣れた仕事と新しい仕事を選べる場面では、慣れた仕事をさらに深めたい。",
      "日々一緒に働く相手とは、用件がないときも普段から会話しておきたい。",
      "日々一緒に働く相手との会話は、必要な報告や相談に絞りたい。",
      "進め方を選べる仕事では、相手に細かく確認するより自分の判断で進めたい。",
      "進め方を選べる仕事では、自分だけで決めるより相手と方針を確認しながら取り組みたい。",
      "長く続く仕事では、一区切りを待たず相手からこまめに意見をもらいたい。",
      "長く続く仕事では、途中より一区切りついた時に相手から意見をもらいたい。",
      "会議で相手と意見が違うときも、自分の考えを率直に伝えたい。",
      "会議で相手と意見が違うときは、自分の考えを伝えるより相手の判断に合わせたい。",
    ]);
    expect(body.questions.every(({ text }) => !text.includes("上司"))).toBe(true);
  });

  it("家族との距離感・支え合いの状況ベース10問をseedから返すこと", async () => {
    const response = await request("known-token", "/api/diagnoses/family-support-style");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      title: string;
      relationshipCategory: string;
      questions: Array<{ diagnosisQuestionId: string; text: string }>;
    };

    expect(body).toMatchObject({
      id: "family-support-style",
      title: "家族との距離感・支え合い",
      relationshipCategory: "family",
    });
    expect(body.questions.map(({ text }) => text)).toEqual([
      "家族としばらく会えない時期には、用事がなくても定期的に連絡を取りたい。",
      "家族としばらく会えない時期には、必要な用事があるときだけ連絡すればよい。",
      "自分が困りごとを抱えたときは、深刻になる前に家族へ話したい。",
      "自分が困りごとを抱えたときは、助けが必要になるまで家族には話さずにおきたい。",
      "家族が悩みを話したときは、具体策を考えるより先に気持ちを聞きたい。",
      "家族が悩みを話したときは、気持ちを聞くより先に具体的にできることを考えたい。",
      "家族と意見が食い違ったときは、時間を置くよりその場で話し合いたい。",
      "家族と意見が食い違ったときは、その場で話すより時間を置いてから話し合いたい。",
      "家族と一緒に過ごす予定は、早めに相談して決めたい。",
      "家族と一緒に過ごす予定は、直前に都合を合わせて決めてもよい。",
    ]);
  });

  it("友達との距離感・付き合い方の状況ベース10問をseedから返すこと", async () => {
    const response = await request("known-token", "/api/diagnoses/friendship-style");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      title: string;
      relationshipCategory: string;
      questions: Array<{ diagnosisQuestionId: string; text: string }>;
    };

    expect(body).toMatchObject({
      id: "friendship-style",
      title: "友達との距離感・付き合い方",
      relationshipCategory: "friend",
    });
    expect(body.questions.map(({ text }) => text)).toEqual([
      "友達としばらく連絡を取っていないと気づいたときは、用事がなくても自分から連絡したい。",
      "友達としばらく連絡を取っていないと気づいても、次の用事ができるまで連絡しなくてよい。",
      "友達と会う予定を立てるときは、直前に誘うより早めに日程を相談したい。",
      "友達と会う予定を立てるときは、早めに決めるより直前に都合を合わせたい。",
      "自分が悩んでいるときは、友達から聞かれなくても早めに話したい。",
      "自分が悩んでいるときは、友達から聞かれるまで自分からは話さずにおきたい。",
      "仲のよい友達同士がまだ会ったことがないときは、機会を作って紹介したい。",
      "仲のよい友達同士がまだ会ったことがないときも、無理に紹介せずそれぞれ別に付き合いたい。",
      "友達の言葉に引っかかったときは、一人で考えるよりその場で理由を確かめたい。",
      "友達の言葉に引っかかったときは、その場で確かめるより一度自分の中で整理してから話したい。",
    ]);
  });

  it("決め方・迷いとの向き合い方の状況ベース10問をseedから返すこと", async () => {
    const response = await request("known-token", "/api/diagnoses/decision-making-style");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      title: string;
      relationshipCategory: string;
      questions: Array<{ diagnosisQuestionId: string; text: string }>;
    };

    expect(body).toMatchObject({
      id: "decision-making-style",
      title: "決め方・迷いとの向き合い方",
      relationshipCategory: "general",
    });
    expect(body.questions.map(({ text }) => text)).toEqual([
      "初めて買う道具を選ぶときは、候補を一つに絞る前に複数のレビューを比べたい。",
      "初めて買う道具を選ぶときは、必要な条件を満たす候補が見つかれば、それ以上は調べずに決めたい。",
      "締切まで一週間ある申し込みをするか迷ったときは、早めに参加するか決めたい。",
      "締切まで一週間ある申し込みをするか迷ったときは、すぐには決めず、締切が近づくまで考えたい。",
      "二つの選択肢に大きな差がないときは、最初にしっくりきた方を選びたい。",
      "二つの選択肢に大きな差がないときも、選ぶ理由を言葉にできる方を選びたい。",
      "初めて経験することを始めるか迷ったときは、自分の考えを固める前に経験者の意見を聞きたい。",
      "初めて経験することを始めるか迷ったときは、経験者に聞く前に自分の考えを固めたい。",
      "予定を決めたあとに重要な新しい情報が分かったときは、決めた内容を見直したい。",
      "予定を決めたあとに新しい情報が分かっても、大きな問題がなければ最初に決めた内容で進めたい。",
    ]);
  });

  it("仕事の進め方・優先順位の状況ベース10問をseedから返すこと", async () => {
    const response = await request("known-token", "/api/diagnoses/work-priority-style");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      title: string;
      relationshipCategory: string;
      questions: Array<{ diagnosisQuestionId: string; text: string }>;
    };

    expect(body).toMatchObject({
      id: "work-priority-style",
      title: "仕事の進め方・優先順位",
      relationshipCategory: "work",
    });
    expect(body.questions.map(({ text }) => text)).toEqual([
      "提出期限まで二日ある資料が必要な内容を満たしたときは、細部を整えるより次の仕事へ進みたい。",
      "提出期限まで二日ある資料が必要な内容を満たしても、次の仕事へ進む前に細部を整えたい。",
      "同じ週が締切の二つの仕事を任されたときは、両方に少しずつ着手して並行して進めたい。",
      "同じ週が締切の二つの仕事を任されたときは、一方を終えてからもう一方に着手したい。",
      "期限の二日前に提出できる状態になった仕事は、その時点で提出したい。",
      "期限の二日前に提出できる状態になった仕事も、期限近くまで見直してから提出したい。",
      "一週間の作業計画を決めたあと、期限に余裕のある新しい依頼が入ったときは、優先順位を組み替えて早めに着手したい。",
      "一週間の作業計画を決めたあと、期限に余裕のある新しい依頼が入っても、まず当初の計画どおり進めたい。",
      "数日かかる仕事では、最初の進み具合を全体が形になる前に共有したい。",
      "数日かかる仕事では、最初の進み具合を全体が形になってから共有したい。",
    ]);
    expect(body.questions.every(({ text }) => !text.includes("上司"))).toBe(true);
  });

  it("家族の期待と自分の選択の状況ベース10問をseedから返すこと", async () => {
    const response = await request("known-token", "/api/diagnoses/family-expectation-choice");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      title: string;
      relationshipCategory: string;
      questions: Array<{ diagnosisQuestionId: string; text: string }>;
    };

    expect(body).toMatchObject({
      id: "family-expectation-choice",
      title: "家族の期待と自分の選択",
      relationshipCategory: "family",
    });
    expect(body.questions.map(({ text }) => text)).toEqual([
      "今後に関わる大きな選択で迷ったときは、自分の考えを固める前に家族へ相談したい。",
      "今後に関わる大きな選択で迷ったときは、家族へ相談する前に自分の考えを固めたい。",
      "興味のある進路と家族が安心する進路が異なるときは、自分の関心より家族の安心を優先したい。",
      "興味のある進路と家族が安心する進路が異なるときは、家族の安心より自分の関心を優先したい。",
      "働き方を大きく変えると決めたときは、家族が納得してから進めたい。",
      "働き方を大きく変えると決めたときは、家族が納得していなくても、自分の考えが決まっていれば進めたい。",
      "結婚を考えている相手について家族が心配しているときは、自分の考えが決まっていても、家族が納得するまで結婚へ進むのを待ちたい。",
      "結婚を考えている相手について家族が心配しているときは、家族が納得していなくても、自分の考えが決まっていれば結婚へ進みたい。",
      "住む場所を選ぶとき、自分の希望と家族の近くで暮らすことが両立しなければ、家族との近さを優先したい。",
      "住む場所を選ぶとき、希望する地域が家族から離れていても、自分の生活条件を優先したい。",
    ]);
  });

  it("友達との信頼・秘密・境界線の状況ベース10問をseedから返すこと", async () => {
    const response = await request("known-token", "/api/diagnoses/friend-trust-boundaries");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      title: string;
      relationshipCategory: string;
      questions: Array<{ diagnosisQuestionId: string; text: string }>;
    };

    expect(body).toMatchObject({
      id: "friend-trust-boundaries",
      title: "友達との信頼・秘密・境界線",
      relationshipCategory: "friend",
    });
    expect(body.questions.map(({ text }) => text)).toEqual([
      "友達が、共通の友達も知っている個人的な出来事を話したときは、秘密だと言われていなくても、本人に確認するまでほかの人には話さずにおきたい。",
      "友達が、共通の友達も知っている個人的な出来事を話したときは、秘密だと言われていなければ、本人に確認せず共通の友達との会話で触れてもよい。",
      "友達の悩みについて自分だけでは助言できず、詳しい人に相談したいときは、誰のことか分からない話し方でも、本人に確認してから相談したい。",
      "友達の悩みについて自分だけでは助言できず、詳しい人に相談したいときは、誰のことか分からない話し方にできれば、本人に確認せず相談してもよい。",
      "あらかじめ投稿してよい範囲を決めている友達との写真をSNSへ載せるときも、写真ごとに本人へ確認したい。",
      "あらかじめ投稿してよい範囲を決めている友達との写真をSNSへ載せるときは、その範囲内なら写真ごとの確認はしなくてよい。",
      "友達との約束を変える可能性が出たものの、まだ予定が確定していないときは、可能性の段階で早めに伝えたい。",
      "友達との約束を変える可能性が出たものの、まだ予定が確定していないときは、変更が確定するまで伝えず、まず自分で調整したい。",
      "友達に答えたくない個人的なことを聞かれたときは、その場で答えたくないと伝えたい。",
      "友達に答えたくない個人的なことを聞かれたときは、その場では話題を変え、あとで落ち着いてから境界を伝えたい。",
    ]);
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
