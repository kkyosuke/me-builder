import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { type AccountDataNamespace, D1, DO } from "@me-builder/lib";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { type AccountDataTestStore, createAccountDataTestStore } from "../testing/account-data";
import {
  type CompatibilityDataTestStore,
  createCompatibilityDataTestStore,
} from "../testing/compatibility-data";
import { compatibilitySharePreviewCases } from "./case/compatibility-share-preview.case";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const diagnosisSeed = path.join(repositoryRoot, "packages/lib/seeds/diagnoses.sql");
const timestamp = 1_786_492_800;
const e2eTimeoutMs = 30_000;
const participants = {
  inviter: { accountId: "account-inviter-e2e", lineId: "line-inviter-e2e", name: "あおい" },
  recipient: { accountId: "account-recipient-e2e", lineId: "line-recipient-e2e", name: "はる" },
} as const;

let miniflare: Miniflare;
let database: D1Database;
let compatibilityDataStore: CompatibilityDataTestStore;
let stores: Record<keyof typeof participants, AccountDataTestStore>;
let accountData: AccountDataNamespace;

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
  }
}

function mockLineVerification(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body instanceof URLSearchParams
            ? init.body.toString()
            : "";
      const token = new URLSearchParams(body).get("id_token");
      const participant = token === "inviter-token" ? participants.inviter : participants.recipient;
      return Response.json({
        iss: "https://access.line.me",
        sub: participant.lineId,
        aud: "1234567890",
        exp: timestamp + 86_400,
        name: participant.name,
      });
    }),
  );
}

function env() {
  return {
    DB: database,
    ACCOUNT_DATA: accountData,
    COMPATIBILITY_DATA: compatibilityDataStore.namespace,
    LINE_LOGIN_CHANNEL_ID: "1234567890",
    ENVIRONMENT: "test",
    WEB_ORIGIN: "https://example.com",
  };
}

async function issueInvitationForInviter(): Promise<string> {
  const sharePreviewResponse = await app.request(
    "/api/compatibility/share-preview",
    { headers: { Authorization: "Bearer inviter-token" } },
    env(),
  );
  expect(sharePreviewResponse.status).toBe(200);
  const sharePreview = (await sharePreviewResponse.json()) as { previewToken: string };
  const issueResponse = await app.request(
    "/api/compatibility/invitations",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer inviter-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ previewToken: sharePreview.previewToken }),
    },
    env(),
  );
  expect(issueResponse.status).toBe(201);
  const issued = (await issueResponse.json()) as { invitationUrl: string };
  const relationshipId = new URL(issued.invitationUrl).pathname.split("/").at(-1);
  if (!relationshipId) throw new Error("relationship ID was not issued");
  return relationshipId;
}

async function completeDiagnosis(token: string): Promise<void> {
  for (let index = 1; index <= 10; index += 1) {
    const questionId = `dq-relationship-priority-${String(index).padStart(2, "0")}`;
    const response = await app.request(
      `/api/diagnoses/relationship-priority/answers/${questionId}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
  const recordedAt = new Date("2026-08-12T00:00:00.000Z");
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
    mockLineVerification();
  }, e2eTimeoutMs);

  afterEach(async () => {
    vi.unstubAllGlobals();
    await miniflare.dispose();
  });

  it(
    `${compatibilitySharePreviewCases.previewInvitation.id}: ${compatibilitySharePreviewCases.previewInvitation.name}`,
    async () => {
      await Promise.all([completeDiagnosis("inviter-token"), completeDiagnosis("recipient-token")]);
      await Promise.all([
        generateShareProfile("inviter", "私は、先の見通しを持って動けると安心します"),
        generateShareProfile("recipient", "私は、予定に余白があると心地よく感じます"),
      ]);

      const relationshipId = await issueInvitationForInviter();
      await generateShareProfile(
        "inviter",
        "私は、新しく作ったまとめだけに含まれる内容です",
        "updated",
      );

      const previewResponse = await app.request(
        `/api/compatibility/invitations/${relationshipId}`,
        { headers: { Authorization: "Bearer recipient-token" } },
        env(),
      );
      expect(previewResponse.status).toBe(200);
      const preview = (await previewResponse.json()) as {
        inviter: {
          displayName: string;
          aboutMe: { statements: { statement: string }[] };
          themes: unknown[];
        };
        recipient: { displayName: string; aboutMe: unknown; themes: unknown[] };
        canAccept: boolean;
        blockingReasons: string[];
      };
      expect(preview).toMatchObject({
        inviter: { displayName: "あおい", aboutMe: expect.any(Object) },
        recipient: { displayName: "はる", aboutMe: expect.any(Object) },
        canAccept: true,
        blockingReasons: [],
      });
      expect(preview.inviter.themes).toHaveLength(1);
      expect(preview.recipient.themes).toHaveLength(1);
      expect(preview.inviter.aboutMe.statements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            statement: "私は、先の見通しを持って動けると安心します",
          }),
        ]),
      );
      expect(preview.inviter.aboutMe.statements).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            statement: "私は、新しく作ったまとめだけに含まれる内容です",
          }),
        ]),
      );
      expect(JSON.stringify(preview)).not.toMatch(
        /accountId|fingerprint|choiceId|evidenceId|inviteeAccountId/,
      );
      expect(compatibilityDataStore.relationships.get(relationshipId)?.status).toBe("pending");
      expect(
        stores.recipient.raw
          .prepare("SELECT COUNT(*) AS count FROM compatibility_references")
          .get(),
      ).toEqual({ count: 0 });

      const ownResponse = await app.request(
        `/api/compatibility/invitations/${relationshipId}`,
        { headers: { Authorization: "Bearer inviter-token" } },
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
    `${compatibilitySharePreviewCases.previewInvitationWithIncompleteRecipient.id}: ${compatibilitySharePreviewCases.previewInvitationWithIncompleteRecipient.name}`,
    async () => {
      await completeDiagnosis("inviter-token");
      await generateShareProfile("inviter", "私は、先の見通しを持って動けると安心します");
      const relationshipId = await issueInvitationForInviter();

      const response = await app.request(
        `/api/compatibility/invitations/${relationshipId}`,
        { headers: { Authorization: "Bearer recipient-token" } },
        env(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        inviter: { displayName: "あおい", themes: expect.any(Array) },
        recipient: { displayName: "はる", aboutMe: null, themes: [] },
        canAccept: false,
        blockingReasons: expect.arrayContaining([
          "profile_summary_required",
          "diagnosis_required",
          "common_diagnosis_required",
        ]),
        nextAction: "profile-summary",
      });
      expect(compatibilityDataStore.relationships.get(relationshipId)?.status).toBe("pending");
      expect(
        stores.recipient.raw
          .prepare("SELECT COUNT(*) AS count FROM compatibility_references")
          .get(),
      ).toEqual({ count: 0 });
    },
    e2eTimeoutMs,
  );

  it(
    `${compatibilitySharePreviewCases.acceptInvitation.id} / ${compatibilitySharePreviewCases.relationshipDetail.id}: 承諾後に双方が相手を先にした相性シートを取得できること`,
    async () => {
      await Promise.all([completeDiagnosis("inviter-token"), completeDiagnosis("recipient-token")]);
      await Promise.all([
        generateShareProfile("inviter", "私は、先の見通しを持って動けると安心します"),
        generateShareProfile("recipient", "私は、予定に余白があると心地よく感じます"),
      ]);
      const relationshipId = await issueInvitationForInviter();
      const previewResponse = await app.request(
        `/api/compatibility/invitations/${relationshipId}`,
        { headers: { Authorization: "Bearer recipient-token" } },
        env(),
      );
      const preview = (await previewResponse.json()) as {
        recipient: { previewToken: string };
      };
      const pendingInviterList = await app.request(
        "/api/compatibility/relationships",
        { headers: { Authorization: "Bearer inviter-token" } },
        env(),
      );
      expect(await pendingInviterList.json()).toEqual({
        items: [expect.objectContaining({ relationshipId, status: "pending" })],
      });
      const pendingRecipientList = await app.request(
        "/api/compatibility/relationships",
        { headers: { Authorization: "Bearer recipient-token" } },
        env(),
      );
      expect(await pendingRecipientList.json()).toEqual({ items: [] });

      const response = await app.request(
        `/api/compatibility/invitations/${relationshipId}/accept`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer recipient-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ previewToken: preview.recipient.previewToken }),
        },
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

      for (const role of ["inviter", "recipient"] as const) {
        const detailResponse = await app.request(
          `/api/compatibility/relationships/${relationshipId}`,
          { headers: { Authorization: `Bearer ${role}-token` } },
          env(),
        );
        expect(detailResponse.status).toBe(200);
        const detail = (await detailResponse.json()) as {
          status: string;
          partner: { displayName: string; themes: unknown[] };
          viewer: { displayName: string; themes: unknown[] };
        };
        const partnerRole = role === "inviter" ? "recipient" : "inviter";
        expect(detail).toMatchObject({
          status: "ready",
          partner: { displayName: participants[partnerRole].name },
          viewer: { displayName: participants[role].name },
        });
        expect(detail.partner.themes).toHaveLength(1);
        expect(detail.viewer.themes).toHaveLength(1);
        expect(JSON.stringify(detail)).not.toMatch(/accountId|fingerprint|choiceId|evidenceId/);

        const listResponse = await app.request(
          "/api/compatibility/relationships",
          { headers: { Authorization: `Bearer ${role}-token` } },
          env(),
        );
        expect(await listResponse.json()).toEqual({
          items: [
            {
              relationshipId,
              status: "accepted",
              partnerDisplayName: participants[partnerRole].name,
            },
          ],
        });
      }
    },
    e2eTimeoutMs,
  );

  it(
    `${compatibilitySharePreviewCases.previewCancelledInvitation.id}: ${compatibilitySharePreviewCases.previewCancelledInvitation.name}`,
    async () => {
      await completeDiagnosis("inviter-token");
      await generateShareProfile("inviter", "私は、先の見通しを持って動けると安心します");
      const relationshipId = await issueInvitationForInviter();
      await expect(
        compatibilityDataStore.namespace
          .getByName(relationshipId)
          .cancelInvitation(relationshipId, participants.inviter.accountId),
      ).resolves.toMatchObject({ outcome: "cancelled" });

      const response = await app.request(
        `/api/compatibility/invitations/${relationshipId}`,
        { headers: { Authorization: "Bearer recipient-token" } },
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
    },
    e2eTimeoutMs,
  );
});
