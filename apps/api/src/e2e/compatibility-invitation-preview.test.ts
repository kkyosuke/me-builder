import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { type AccountDataNamespace, D1, DO } from "@me-builder/lib";
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

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const diagnosisSeed = path.join(repositoryRoot, "packages/lib/seeds/diagnoses.sql");
const timestamp = 1_786_492_800;
const e2eTimeoutMs = 30_000;
const participants = {
  inviter: { accountId: "account-inviter-e2e", lineId: "line-inviter-e2e", name: "あおい" },
  recipient: { accountId: "account-recipient-e2e", lineId: "line-recipient-e2e", name: "はる" },
  thirdParty: {
    accountId: "account-third-party-e2e",
    lineId: "line-third-party-e2e",
    name: "そら",
  },
} as const;

let miniflare: Miniflare;
let database: D1Database;
let compatibilityDataStore: CompatibilityDataTestStore;
let stores: Record<keyof typeof participants, AccountDataTestStore>;
let accountData: AccountDataNamespace;
let sessionFixture: ReturnType<typeof createApplicationSessionFixture>;
let sessionHeaders: Record<keyof typeof participants, Record<string, string>>;

async function applySqlFile(db: D1Database, sql: string): Promise<void> {
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
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
  for (const participant of Object.values(participants)) {
    await db
      .prepare(
        `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status)
         VALUES (?, ?, ?, 0, 'active')`,
      )
      .bind(participant.accountId, timestamp, timestamp)
      .run();
    await db
      .prepare(
        `INSERT INTO account_identities (
           id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
         ) VALUES (?, ?, ?, 0, ?, 'line_login', ?)`,
      )
      .bind(
        `identity-${participant.accountId}`,
        timestamp,
        timestamp,
        participant.accountId,
        participant.lineId,
      )
      .run();
    await D1.shared.action.agreement.acceptCurrentTerms(
      D1.shared.client.create(db),
      participant.accountId,
    );
  }
}

function env() {
  return {
    DB: database,
    ACCOUNT_DATA: accountData,
    COMPATIBILITY_DATA: compatibilityDataStore.namespace,
    AVATAR_BUCKET: {} as R2Bucket,
    ...sessionFixture.bindings,
    LIFF_ID: "1234567890-testliff",
    ENVIRONMENT: "test",
  };
}

function headersForToken(token: string): Record<string, string> {
  return token.startsWith("inviter") ? sessionHeaders.inviter : sessionHeaders.recipient;
}

async function issueInvitationForInviter(): Promise<string> {
  const consentResponse = await app.request(
    "/api/compatibility/share-consent",
    { headers: sessionHeaders.inviter },
    env(),
  );
  expect(consentResponse.status).toBe(200);
  expect(await consentResponse.json()).toMatchObject({ canShare: true });
  const issueResponse = await app.request(
    "/api/compatibility/invitations",
    {
      method: "POST",
      headers: {
        ...sessionHeaders.inviter,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ relationshipCategory: "partner" }),
    },
    env(),
  );
  expect(issueResponse.status).toBe(201);
  const issued = (await issueResponse.json()) as {
    invitationUrl: string;
    relationshipCategory: string;
  };
  expect(issued.relationshipCategory).toBe("partner");
  expect(issued.invitationUrl).toMatch(
    /^https:\/\/liff\.line\.me\/1234567890-testliff\/compatibility\/invitations\/[a-f0-9]{64}$/,
  );
  const relationshipId = new URL(issued.invitationUrl).pathname.split("/").at(-1);
  if (!relationshipId) throw new Error("relationship ID was not issued");
  return relationshipId;
}

async function completeDiagnosis(
  token: string,
  diagnosisId = "relationship-priority",
  questionIdPrefix = diagnosisId,
): Promise<void> {
  for (let index = 1; index <= 10; index += 1) {
    const questionId = `dq-${questionIdPrefix}-${String(index).padStart(2, "0")}`;
    const response = await app.request(
      `/api/diagnoses/${diagnosisId}/answers/${questionId}`,
      {
        method: "PUT",
        headers: { ...headersForToken(token), "Content-Type": "application/json" },
        body: JSON.stringify({ choiceId: "yes" }),
      },
      env(),
    );
    expect(response.status).toBe(200);
  }
}

async function generateShareProfile(
  role: keyof typeof participants,
  statement: string,
  revision = "initial",
): Promise<void> {
  const participant = participants[role];
  const store = stores[role];
  const suffix = `${role}-${revision}`;
  const recordedAt = new Date(
    revision === "initial" ? "2026-08-12T00:00:00.000Z" : "2026-08-20T00:00:00.000Z",
  );
  const source = await DO.account.action.diary.storeLineTextSource(store.db, {
    accountId: participant.accountId,
    eventId: `compatibility-profile-${suffix}`,
    body: statement,
    receivedAt: recordedAt,
  });
  store.raw
    .prepare(
      `INSERT INTO conversation_sessions (
         id, created_at, updated_at, is_deleted, account_id, status, started_at,
         last_user_message_at, conversation_policy_id, reply_opportunity_count,
         reply_count, awaiting_reply, next_sequence
       ) VALUES (?, ?, ?, 0, ?, 'closed', ?, ?, 'reflective', 0, 0, 0, 2)`,
    )
    .run(
      `compatibility-session-${suffix}`,
      timestamp,
      timestamp,
      participant.accountId,
      timestamp,
      timestamp,
    );
  store.raw
    .prepare(
      `INSERT INTO conversation_messages (
         id, created_at, updated_at, is_deleted, session_id, sequence, role,
         source_record_id, channel
       ) VALUES (?, ?, ?, 0, ?, 1, 'user', ?, 'line')`,
    )
    .run(
      `compatibility-message-${suffix}`,
      timestamp,
      timestamp,
      `compatibility-session-${suffix}`,
      source.sourceRecordId,
    );
  const request = await DO.account.action.profileSummary.requestProfileSummaryGeneration(
    store.db,
    participant.accountId,
    recordedAt,
  );
  if (request.outcome !== "created") throw new Error("profile generation was not created");
  const context = await DO.account.action.profileSummary.loadProfileSummaryGenerationContext(
    store.db,
    participant.accountId,
    request.generationId,
  );
  const evidenceId = context?.evidence[0]?.id;
  if (!context || !evidenceId) throw new Error("profile evidence was not available");
  await DO.account.action.profileSummary.completeProfileSummaryGeneration(
    store.db,
    participant.accountId,
    {
      generationId: request.generationId,
      generatedAt: recordedAt,
      model: "gemini-test",
      promptVersion: "profile-summary-v2",
      headline: statement,
      insights: [],
      compatibilityShareStatements: [
        {
          key: "planning-style",
          label: "予定の立て方",
          statement,
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

describe("GET /api/compatibility/invitations/:relationshipId E2E", () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "compatibility-invitation-preview-e2e" },
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    await prepareDatabase(database);
    stores = {
      inviter: createAccountDataTestStore(),
      recipient: createAccountDataTestStore(),
      thirdParty: createAccountDataTestStore(),
    };
    const shared = D1.shared.client.create(database);
    await Promise.all(Object.values(stores).map((store) => store.syncCatalogFrom(shared)));
    const storesByAccountId = new Map<string, AccountDataTestStore>(
      Object.entries(stores).map(([role, store]) => [
        participants[role as keyof typeof participants].accountId,
        store,
      ]),
    );
    accountData = {
      getByName(name) {
        const store = storesByAccountId.get(name);
        if (!store) throw new Error("Unknown AccountData test participant");
        return store.namespace.getByName(name);
      },
    };
    compatibilityDataStore = createCompatibilityDataTestStore();
    sessionFixture = createApplicationSessionFixture(database);
    sessionHeaders = {
      inviter: (
        await sessionFixture.issue(participants.inviter.accountId, {
          displayName: participants.inviter.name,
        })
      ).headers,
      recipient: (
        await sessionFixture.issue(participants.recipient.accountId, {
          displayName: participants.recipient.name,
        })
      ).headers,
      thirdParty: (
        await sessionFixture.issue(participants.thirdParty.accountId, {
          displayName: participants.thirdParty.name,
        })
      ).headers,
    };
  }, e2eTimeoutMs);

  afterEach(async () => {
    await miniflare.dispose();
  });

  it(
    "既存の採点設定に関わり方文がない場合はseed再適用で補完する",
    async () => {
      await database
        .prepare(
          `UPDATE diagnosis_scoring_configs
           SET definition = json_remove(definition, '$.parameters[0].relationshipRequests')
           WHERE id = 'relationship-priority-v1'`,
        )
        .run();

      await applySqlFile(database, await readFile(diagnosisSeed, "utf8"));

      expect(
        await database
          .prepare(
            `SELECT json_extract(
               definition,
               '$.parameters[0].relationshipRequests.low'
             ) AS request
             FROM diagnosis_scoring_configs
             WHERE id = 'relationship-priority-v1'`,
          )
          .first(),
      ).toEqual({ request: "自分の希望を聞く時間を作ってもらえるとうれしいです。" });
    },
    e2eTimeoutMs,
  );

  it(
    `${compatibilityShareCases.previewInvitation.id}: ${compatibilityShareCases.previewInvitation.name}`,
    async () => {
      await Promise.all([completeDiagnosis("inviter-token"), completeDiagnosis("recipient-token")]);
      await Promise.all([
        generateShareProfile("inviter", "私は、先の見通しを持って動けると安心します"),
        generateShareProfile("recipient", "私は、予定に余白があると心地よく感じます"),
      ]);

      const relationshipId = await issueInvitationForInviter();

      const previewResponse = await app.request(
        `/api/compatibility/invitations/${relationshipId}`,
        { headers: sessionHeaders.recipient },
        env(),
      );
      expect(previewResponse.status).toBe(200);
      const preview = await previewResponse.json();
      expect(preview).toEqual({
        relationshipCategory: "partner",
        inviter: {
          displayName: "あおい",
          avatarUrl: `/api/compatibility/invitations/${relationshipId}/avatar`,
        },
        recipient: { displayName: "はる", avatarUrl: "/api/profile/avatar" },
        expiresAt: expect.any(String),
        canAccept: true,
        blockingReasons: [],
        nextAction: null,
      });
      expect(JSON.stringify(preview)).not.toMatch(
        /aboutMe|themes|statement|accountId|fingerprint|choiceId|evidenceId|inviteeAccountId/,
      );
      expect(compatibilityDataStore.relationships.get(relationshipId)?.status).toBe("pending");
      expect(
        stores.recipient.raw
          .prepare("SELECT COUNT(*) AS count FROM compatibility_references")
          .get(),
      ).toEqual({ count: 0 });

      const ownResponse = await app.request(
        `/api/compatibility/invitations/${relationshipId}`,
        { headers: sessionHeaders.inviter },
        env(),
      );
      expect(ownResponse.status).toBe(409);
      expect(await ownResponse.json()).toEqual({
        error: "Compatibility invitation unavailable",
        reason: "own_invitation",
      });
    },
    e2eTimeoutMs,
  );

  it(
    `${compatibilityShareCases.acceptWithoutSharableContent.id}: ${compatibilityShareCases.acceptWithoutSharableContent.name}`,
    async () => {
      await completeDiagnosis("inviter-token");
      await generateShareProfile("inviter", "私は、先の見通しを持って動けると安心します");
      const relationshipId = await issueInvitationForInviter();

      const previewResponse = await app.request(
        `/api/compatibility/invitations/${relationshipId}`,
        { headers: sessionHeaders.recipient },
        env(),
      );
      expect(previewResponse.status).toBe(200);
      expect(await previewResponse.json()).toMatchObject({
        relationshipCategory: "partner",
        canAccept: true,
        blockingReasons: [],
        nextAction: "profile-summary",
      });

      const acceptResponse = await app.request(
        `/api/compatibility/invitations/${relationshipId}/accept`,
        { method: "POST", headers: sessionHeaders.recipient },
        env(),
      );
      expect(acceptResponse.status).toBe(200);
      expect(compatibilityDataStore.relationships.get(relationshipId)?.status).toBe("accepted");

      const waitingResponse = await app.request(
        `/api/compatibility/relationships/${relationshipId}`,
        { headers: sessionHeaders.recipient },
        env(),
      );
      expect(waitingResponse.status).toBe(200);
      expect(await waitingResponse.json()).toEqual({
        relationshipId,
        status: "waiting",
        relationshipCategory: "partner",
        nextAction: "profile-summary",
      });
      const waitingListResponse = await app.request(
        "/api/compatibility/relationships",
        { headers: sessionHeaders.recipient },
        env(),
      );
      expect(await waitingListResponse.json()).toEqual({
        items: [
          {
            relationshipId,
            status: "accepted",
            relationshipCategory: "partner",
            partnerDisplayName: "あおい",
            readiness: { status: "waiting", nextAction: "profile-summary" },
          },
        ],
      });

      // 追加の同意なしに、そろった内容がそのまま相性シートへ反映される。
      await completeDiagnosis("recipient-token");
      await generateShareProfile("recipient", "私は、予定に余白があると心地よく感じます");

      const readyResponse = await app.request(
        `/api/compatibility/relationships/${relationshipId}`,
        { headers: sessionHeaders.recipient },
        env(),
      );
      expect(readyResponse.status).toBe(200);
      expect(await readyResponse.json()).toMatchObject({
        status: "ready",
        relationshipCategory: "partner",
        partner: { displayName: "あおい" },
        viewer: { displayName: "はる" },
      });
      const readyListResponse = await app.request(
        "/api/compatibility/relationships",
        { headers: sessionHeaders.recipient },
        env(),
      );
      expect(await readyListResponse.json()).toEqual({
        items: [
          {
            relationshipId,
            status: "accepted",
            relationshipCategory: "partner",
            partnerDisplayName: "あおい",
            readiness: { status: "ready", comparableThemeCount: 1 },
          },
        ],
      });
    },
    e2eTimeoutMs,
  );

  it(
    `${compatibilityShareCases.acceptForwardedInvitation.id}: ${compatibilityShareCases.acceptForwardedInvitation.name}`,
    async () => {
      const relationshipId = await issueInvitationForInviter();

      const forwardedPreview = await app.request(
        `/api/compatibility/invitations/${relationshipId}`,
        { headers: sessionHeaders.thirdParty },
        env(),
      );
      expect(forwardedPreview.status).toBe(200);
      expect(await forwardedPreview.json()).toMatchObject({
        inviter: { displayName: "あおい" },
        recipient: { displayName: "そら" },
        canAccept: true,
      });

      const forwardedAcceptance = await app.request(
        `/api/compatibility/invitations/${relationshipId}/accept`,
        { method: "POST", headers: sessionHeaders.thirdParty },
        env(),
      );
      expect(forwardedAcceptance.status).toBe(200);
      expect(await forwardedAcceptance.json()).toEqual({ relationshipId, status: "accepted" });

      for (const request of [
        { path: `/api/compatibility/invitations/${relationshipId}`, method: "GET" },
        {
          path: `/api/compatibility/invitations/${relationshipId}/avatar`,
          method: "GET",
        },
        {
          path: `/api/compatibility/invitations/${relationshipId}/accept`,
          method: "POST",
        },
      ]) {
        const response = await app.request(
          request.path,
          { method: request.method, headers: sessionHeaders.recipient },
          env(),
        );
        expect(response.status).toBe(404);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.json()).toEqual({
          error: "Compatibility invitation unavailable",
          reason: "invitation_unavailable",
        });
      }

      const unrelatedList = await app.request(
        "/api/compatibility/relationships",
        { headers: sessionHeaders.recipient },
        env(),
      );
      expect(await unrelatedList.json()).toEqual({ items: [] });
      const unrelatedDetail = await app.request(
        `/api/compatibility/relationships/${relationshipId}`,
        { headers: sessionHeaders.recipient },
        env(),
      );
      expect(unrelatedDetail.status).toBe(404);
      expect(unrelatedDetail.headers.get("Cache-Control")).toBe("no-store");

      const inviterList = await app.request(
        "/api/compatibility/relationships",
        { headers: sessionHeaders.inviter },
        env(),
      );
      expect(await inviterList.json()).toEqual({
        items: [
          {
            relationshipId,
            status: "accepted",
            relationshipCategory: "partner",
            partnerDisplayName: "そら",
            readiness: { status: "waiting", nextAction: "profile-summary" },
          },
        ],
      });

      const acceptedRecipientList = await app.request(
        "/api/compatibility/relationships",
        { headers: sessionHeaders.thirdParty },
        env(),
      );
      expect(await acceptedRecipientList.json()).toEqual({
        items: [
          {
            relationshipId,
            status: "accepted",
            relationshipCategory: "partner",
            partnerDisplayName: "あおい",
            readiness: { status: "waiting", nextAction: "profile-summary" },
          },
        ],
      });
      const acceptedRecipientDetail = await app.request(
        `/api/compatibility/relationships/${relationshipId}`,
        { headers: sessionHeaders.thirdParty },
        env(),
      );
      expect(acceptedRecipientDetail.status).toBe(200);
      expect(await acceptedRecipientDetail.json()).toEqual({
        relationshipId,
        status: "waiting",
        relationshipCategory: "partner",
        nextAction: "profile-summary",
      });
    },
    e2eTimeoutMs,
  );

  it(
    `${compatibilityShareCases.acceptForwardedInvitationConcurrently.id}: ${compatibilityShareCases.acceptForwardedInvitationConcurrently.name}`,
    async () => {
      const relationshipId = await issueInvitationForInviter();
      const candidateRoles = ["recipient", "thirdParty"] as const;
      const responses = await Promise.all(
        candidateRoles.map((role) =>
          app.request(
            `/api/compatibility/invitations/${relationshipId}/accept`,
            { method: "POST", headers: sessionHeaders[role] },
            env(),
          ),
        ),
      );
      const acceptedIndexes = responses.flatMap((response, index) =>
        response.status === 200 ? [index] : [],
      );
      expect(acceptedIndexes).toHaveLength(1);
      const acceptedIndex = acceptedIndexes[0];
      if (acceptedIndex === undefined) throw new Error("accepted candidate was not resolved");
      const rejectedIndex = acceptedIndex === 0 ? 1 : 0;
      expect([404, 409]).toContain(responses[rejectedIndex]?.status);

      const winnerRole = candidateRoles[acceptedIndex];
      const loserRole = candidateRoles[rejectedIndex];
      if (!winnerRole || !loserRole) throw new Error("candidate role was not resolved");
      expect(compatibilityDataStore.relationships.get(relationshipId)).toMatchObject({
        status: "accepted",
        inviteeAccountId: participants[winnerRole].accountId,
      });

      const winnerList = await app.request(
        "/api/compatibility/relationships",
        { headers: sessionHeaders[winnerRole] },
        env(),
      );
      expect(await winnerList.json()).toMatchObject({
        items: [{ relationshipId, status: "accepted", partnerDisplayName: "あおい" }],
      });
      const loserList = await app.request(
        "/api/compatibility/relationships",
        { headers: sessionHeaders[loserRole] },
        env(),
      );
      expect(await loserList.json()).toEqual({ items: [] });
      const loserDetail = await app.request(
        `/api/compatibility/relationships/${relationshipId}`,
        { headers: sessionHeaders[loserRole] },
        env(),
      );
      expect(loserDetail.status).toBe(404);
      expect(loserDetail.headers.get("Cache-Control")).toBe("no-store");
      expect(
        stores[loserRole].raw
          .prepare("SELECT COUNT(*) AS count FROM compatibility_references")
          .get(),
      ).toEqual({ count: 0 });
    },
    e2eTimeoutMs,
  );

  it(
    `${compatibilityShareCases.shareJourney.id}: LIFF共有から招待表示・承諾・相性シート・共有終了まで完了できること`,
    async () => {
      await Promise.all([completeDiagnosis("inviter-token"), completeDiagnosis("recipient-token")]);
      await completeDiagnosis("inviter-token", "money-values", "money");
      await Promise.all([
        generateShareProfile("inviter", "私は、先の見通しを持って動けると安心します"),
        generateShareProfile("recipient", "私は、予定に余白があると心地よく感じます"),
      ]);
      const relationshipId = await issueInvitationForInviter();
      const pendingInviterList = await app.request(
        "/api/compatibility/relationships",
        { headers: sessionHeaders.inviter },
        env(),
      );
      expect(await pendingInviterList.json()).toEqual({
        items: [
          expect.objectContaining({
            relationshipId,
            status: "pending",
            relationshipCategory: "partner",
            invitationUrl: `https://liff.line.me/1234567890-testliff/compatibility/invitations/${relationshipId}`,
          }),
        ],
      });
      const pendingRecipientList = await app.request(
        "/api/compatibility/relationships",
        { headers: sessionHeaders.recipient },
        env(),
      );
      expect(await pendingRecipientList.json()).toEqual({ items: [] });

      const response = await app.request(
        `/api/compatibility/invitations/${relationshipId}/accept`,
        { method: "POST", headers: sessionHeaders.recipient },
        env(),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ relationshipId, status: "accepted" });
      expect(compatibilityDataStore.relationships.get(relationshipId)?.status).toBe("accepted");
      for (const role of ["inviter", "recipient"] as const) {
        expect(
          stores[role].raw
            .prepare(
              "SELECT relationship_id, status FROM compatibility_references WHERE relationship_id = ?",
            )
            .get(relationshipId),
        ).toEqual({ relationship_id: relationshipId, status: "active" });
      }

      // 承諾後に更新したまとめも、再同意なしで双方の相性シートへ反映される。
      await generateShareProfile("inviter", "私は、更新後のまとめに含まれる内容です", "updated");

      for (const role of ["inviter", "recipient"] as const) {
        const detailResponse = await app.request(
          `/api/compatibility/relationships/${relationshipId}`,
          { headers: sessionHeaders[role] },
          env(),
        );
        expect(detailResponse.status).toBe(200);
        const detail = (await detailResponse.json()) as {
          status: string;
          relationshipCategory: string;
          partner: {
            displayName: string;
            aboutMe: { generatedAt: string; statements: { statement: string }[] };
            themes: Array<{
              diagnosisId: string;
              parameters: Array<{ band: string; request?: string }>;
            }>;
          };
          viewer: {
            displayName: string;
            aboutMe: { generatedAt: string; statements: { statement: string }[] };
            themes: Array<{
              diagnosisId: string;
              parameters: Array<{ band: string; request?: string }>;
            }>;
          };
          progression: {
            level: number;
            growthValue: number;
            comparableThemeCount: number;
            marks: number[];
          };
          unavailableThemes: Array<{ diagnosisId: string; title: string }>;
        };
        const partnerRole = role === "inviter" ? "recipient" : "inviter";
        expect(detail).toMatchObject({
          status: "ready",
          relationshipCategory: "partner",
          partner: { displayName: participants[partnerRole].name },
          viewer: { displayName: participants[role].name },
          progression: {
            level: 2,
            growthValue: 3,
            comparableThemeCount: 1,
            marks: [2],
          },
        });
        expect(detail.partner.themes).toHaveLength(1);
        expect(detail.viewer.themes).toHaveLength(1);
        expect(detail.unavailableThemes).toEqual([
          { diagnosisId: "money-values", title: "お金と消費" },
        ]);
        expect(detail.partner.aboutMe.generatedAt).toBe(
          partnerRole === "inviter" ? "2026-08-20T00:00:00.000Z" : "2026-08-12T00:00:00.000Z",
        );
        expect(detail.viewer.aboutMe.generatedAt).toBe(
          role === "inviter" ? "2026-08-20T00:00:00.000Z" : "2026-08-12T00:00:00.000Z",
        );
        for (const person of [detail.partner, detail.viewer]) {
          expect(person.themes[0]?.diagnosisId).toBe("relationship-priority");
          expect(person.themes[0]?.parameters.map(({ band }) => band).sort()).toEqual([
            "balanced",
            "balanced",
            "high",
            "low",
          ]);
          expect(person.themes[0]?.parameters).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                band: "low",
                request: "自分の希望を聞く時間を作ってもらえるとうれしいです。",
              }),
            ]),
          );
        }
        const inviterSide = role === "inviter" ? detail.viewer : detail.partner;
        expect(inviterSide.aboutMe.statements).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ statement: "私は、更新後のまとめに含まれる内容です" }),
          ]),
        );
        expect(JSON.stringify(detail)).not.toMatch(
          /accountId|fingerprint|choiceId|evidenceId|scoringConfig/,
        );

        const listResponse = await app.request(
          "/api/compatibility/relationships",
          { headers: sessionHeaders[role] },
          env(),
        );
        expect(await listResponse.json()).toEqual({
          items: [
            {
              relationshipId,
              status: "accepted",
              relationshipCategory: "partner",
              partnerDisplayName: participants[partnerRole].name,
              readiness: { status: "ready", comparableThemeCount: 1 },
            },
          ],
        });
      }

      const thirdPartyDetail = await app.request(
        `/api/compatibility/relationships/${relationshipId}`,
        { headers: sessionHeaders.thirdParty },
        env(),
      );
      expect(thirdPartyDetail.status).toBe(404);
      expect(thirdPartyDetail.headers.get("Cache-Control")).toBe("no-store");
      expect(await thirdPartyDetail.json()).toEqual({
        error: "Compatibility relationship unavailable",
        reason: "relationship_unavailable",
      });

      const endResponse = await app.request(
        `/api/compatibility/relationships/${relationshipId}`,
        { method: "DELETE", headers: sessionHeaders.recipient },
        env(),
      );
      expect(endResponse.status).toBe(204);
      expect(endResponse.headers.get("Cache-Control")).toBe("no-store");
      expect(compatibilityDataStore.relationships.get(relationshipId)?.status).toBe("ended");
      for (const role of ["inviter", "recipient"] as const) {
        const listResponse = await app.request(
          "/api/compatibility/relationships",
          { headers: sessionHeaders[role] },
          env(),
        );
        expect(await listResponse.json()).toEqual({ items: [] });
        const detailResponse = await app.request(
          `/api/compatibility/relationships/${relationshipId}`,
          { headers: sessionHeaders[role] },
          env(),
        );
        expect(detailResponse.status).toBe(404);
      }

      const resumedRelationshipId = await issueInvitationForInviter();
      const resumedAcceptance = await app.request(
        `/api/compatibility/invitations/${resumedRelationshipId}/accept`,
        { method: "POST", headers: sessionHeaders.recipient },
        env(),
      );
      expect(resumedAcceptance.status).toBe(200);
      const resumedDetail = await app.request(
        `/api/compatibility/relationships/${resumedRelationshipId}`,
        { headers: sessionHeaders.inviter },
        env(),
      );
      expect(resumedDetail.status).toBe(200);
      expect(await resumedDetail.json()).toMatchObject({
        relationshipCategory: "partner",
        progression: { level: 2, growthValue: 3, comparableThemeCount: 1, marks: [2] },
      });
    },
    e2eTimeoutMs,
  );

  it(
    `${compatibilityShareCases.previewCancelledInvitation.id}: ${compatibilityShareCases.previewCancelledInvitation.name}`,
    async () => {
      await completeDiagnosis("inviter-token");
      await generateShareProfile("inviter", "私は、先の見通しを持って動けると安心します");
      const relationshipId = await issueInvitationForInviter();
      const cancelResponse = await app.request(
        `/api/compatibility/invitations/${relationshipId}`,
        { method: "DELETE", headers: sessionHeaders.inviter },
        env(),
      );
      expect(cancelResponse.status).toBe(204);
      expect(cancelResponse.headers.get("Cache-Control")).toBe("no-store");
      expect(compatibilityDataStore.relationships.get(relationshipId)?.status).toBe("cancelled");

      const response = await app.request(
        `/api/compatibility/invitations/${relationshipId}`,
        { headers: sessionHeaders.recipient },
        env(),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: "Compatibility invitation unavailable",
        reason: "invitation_unavailable",
      });
      expect(
        stores.recipient.raw
          .prepare("SELECT COUNT(*) AS count FROM compatibility_references")
          .get(),
      ).toEqual({ count: 0 });
      const listResponse = await app.request(
        "/api/compatibility/relationships",
        { headers: sessionHeaders.inviter },
        env(),
      );
      expect(await listResponse.json()).toEqual({ items: [] });
    },
    e2eTimeoutMs,
  );
});
