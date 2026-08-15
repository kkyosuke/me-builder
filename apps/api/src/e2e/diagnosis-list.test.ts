import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { D1 } from "@me-builder/lib";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { type AccountDataTestStore, createAccountDataTestStore } from "../testing/account-data";
import { diagnosisDetailCases } from "./case/diagnosis-detail.case";
import { diagnosisListCases } from "./case/diagnosis-list.case";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const diagnosisSeed = path.join(repositoryRoot, "packages/lib/seeds/diagnoses.sql");
const timestamp = 1_785_801_600;

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
  const init: RequestInit = idToken ? { headers: { Authorization: `Bearer ${idToken}` } } : {};

  return await app.request(path, init, {
    DB: database,
    ACCOUNT_DATA: accountDataStore.namespace,
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
    accountDataStore = createAccountDataTestStore();
    await accountDataStore.syncCatalogFrom(D1.shared.client.create(database));
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
        relationshipCategory: string;
        description: string;
        displayOrder: number;
        responseStatus: string;
        answeredCount: number;
        questionCount: number;
        lastAnsweredAt: string | null;
      }>;
    };
    expect(initialBody.diagnoses).toHaveLength(11);
    expect(initialBody.diagnoses.map(({ displayOrder }) => displayOrder)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110,
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

  it(`${diagnosisListCases.webFirstAccountCreation.id}: ${diagnosisListCases.webFirstAccountCreation.name}`, async () => {
    const response = await request("unknown-token");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      diagnoses: Array<{ responseStatus: string; answeredCount: number }>;
    };
    expect(body.diagnoses).toHaveLength(10);
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
      relationshipCategory: string;
      questions: Array<{
        diagnosisQuestionId: string;
        questionVersion: number;
        choices: Array<{ choiceId: string; label: string }>;
      }>;
    };
    expect(body.id).toBe("relationship-priority");
    expect(body.relationshipCategory).toBe("partner");
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
