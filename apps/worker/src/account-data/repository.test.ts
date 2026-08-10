import { d1 } from "@me-builder/lib";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AccountDataRepository, type LegacyAccountDataSnapshot } from "./repository";

function createRepository() {
  const sqlite = new Database(":memory:");
  const sql = {
    exec<T>(query: string, ...params: unknown[]) {
      if (params.length === 0 && query.includes(";")) {
        sqlite.exec(query);
        return { toArray: () => [] as T[], one: () => undefined as T };
      }
      const statement = sqlite.prepare(query);
      const rows = statement.reader ? (statement.all(...params) as T[]) : [];
      const rawRows = statement.reader ? (statement.raw(true).all(...params) as unknown[][]) : [];
      if (!statement.reader) statement.run(...params);
      return {
        toArray: () => rows,
        raw: () => ({ toArray: () => rawRows }),
        one: () => {
          const row = rows[0];
          if (!row) throw new Error("Expected one row");
          return row;
        },
      };
    },
  };
  const storage = {
    sql,
    transactionSync: <T>(callback: () => T) => sqlite.transaction(callback)(),
  } as unknown as DurableObjectStorage;
  return Object.assign(new AccountDataRepository(storage), {
    columnNames: (table: string) =>
      sql
        .exec<{ name: string }>(`PRAGMA table_info(${table})`)
        .toArray()
        .map(({ name }) => name),
  });
}

describe("AccountDataRepository", () => {
  it("前回追加したdescendantの冗長なaccount_idをAccountDataへ持ち込まない", async () => {
    const repository = createRepository();
    await repository.initialize();

    const descendantTables = [
      "source_record_text_payloads",
      "source_record_revisions",
      "conversation_messages",
      "chat_turns",
      "diary_brain_checkpoint_items",
      "diagnosis_answers",
      "diagnosis_deferred_questions",
      "diagnosis_brain_projection_requests",
    ];
    for (const table of descendantTables) {
      expect(repository.columnNames(table), table).not.toContain("account_id");
    }
  });

  it("Objectを最初のAccountへ固定し、異なるAccountを拒否する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");

    expect(() => repository.bindAccount("account-2")).toThrow(
      "AccountData Object cannot be used by another account",
    );
  });

  it("別ObjectのAccount所有データをSELECTできない", async () => {
    const first = createRepository();
    const second = createRepository();
    await Promise.all([first.initialize(), second.initialize()]);
    first.bindAccount("account-1");
    second.bindAccount("account-2");

    const source = await d1.action.conversation.storeLineTextSource(first.client, {
      accountId: "account-1",
      eventId: "event-1",
      body: "private diary",
      receivedAt: new Date("2026-08-08T00:00:00.000Z"),
    });

    expect(await second.client.select().from(d1.schema.sourceRecords).all()).toEqual([]);
    expect(
      await second.client
        .select()
        .from(d1.schema.sourceRecordTextPayloads)
        // IDを知っていても別Objectには行そのものがない。
        .where(eq(d1.schema.sourceRecordTextPayloads.sourceRecordId, source.sourceRecordId))
        .get(),
    ).toBeUndefined();
  });

  it("相性一覧参照をAccount内に保存し、同じ相手の重複予約を拒否する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const at = new Date("2026-08-09T00:00:00.000Z");

    const reserved = repository.reserveIncomingCompatibilityReference("account-1", {
      relationshipId: "relationship-1",
      partnerAccountId: "account-2",
      createdAt: at,
    });
    expect(reserved.outcome).toBe("reserved");
    expect(
      repository.reserveIncomingCompatibilityReference("account-1", {
        relationshipId: "relationship-2",
        partnerAccountId: "account-2",
        createdAt: at,
      }),
    ).toMatchObject({
      outcome: "conflict",
      reference: { relationshipId: "relationship-1" },
    });

    expect(
      repository.activateCompatibilityReference("account-1", {
        relationshipId: "relationship-1",
        partnerAccountId: "account-2",
        role: "invitee",
        updatedAt: at,
      }).outcome,
    ).toBe("activated");
    expect(repository.listVisibleCompatibilityReferences("account-1")).toEqual([
      expect.objectContaining({
        relationshipId: "relationship-1",
        partnerAccountId: "account-2",
        status: "active",
      }),
    ]);

    repository.endCompatibilityReference("account-1", "relationship-1", at);
    expect(repository.listVisibleCompatibilityReferences("account-1")).toEqual([]);
  });

  it("未承諾の送信参照には相手Accountを保存しない", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const reference = repository.addOutgoingCompatibilityReference("account-1", {
      relationshipId: "relationship-1",
      createdAt: new Date("2026-08-09T00:00:00.000Z"),
    });

    expect(reference).toMatchObject({
      accountId: "account-1",
      partnerAccountId: null,
      role: "inviter",
      status: "pending",
    });
  });

  it("送受信を問わず同じ相手の予約を1件に制限し、予約を再試行可能に解放する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const at = new Date("2026-08-09T00:00:00.000Z");
    repository.addOutgoingCompatibilityReference("account-1", {
      relationshipId: "relationship-outgoing",
      createdAt: at,
    });

    expect(
      repository.reserveOutgoingCompatibilityReference("account-1", {
        relationshipId: "relationship-outgoing",
        partnerAccountId: "account-2",
        updatedAt: at,
      }),
    ).toMatchObject({
      outcome: "reserved",
      reference: { role: "inviter", partnerAccountId: "account-2", status: "reserved" },
    });
    expect(
      repository.reserveIncomingCompatibilityReference("account-1", {
        relationshipId: "relationship-incoming",
        partnerAccountId: "account-2",
        createdAt: at,
      }),
    ).toMatchObject({
      outcome: "conflict",
      reference: { relationshipId: "relationship-outgoing" },
    });
    expect(repository.listVisibleCompatibilityReferences("account-1")).toEqual([]);
    expect(repository.listReconciliableCompatibilityReferences("account-1")).toEqual([
      expect.objectContaining({ relationshipId: "relationship-outgoing", status: "reserved" }),
    ]);
    expect(
      repository.hasCompatibilityReservation("account-1", {
        relationshipId: "relationship-outgoing",
        partnerAccountId: "account-2",
        role: "inviter",
      }),
    ).toBe(true);
    expect(
      repository.hasCompatibilityReservation("account-1", {
        relationshipId: "relationship-outgoing",
        partnerAccountId: "account-other",
        role: "inviter",
      }),
    ).toBe(false);

    expect(
      repository.releaseCompatibilityReservation("account-1", "relationship-outgoing", at),
    ).toMatchObject({
      outcome: "released",
      reference: { partnerAccountId: null, status: "pending" },
    });
    expect(
      repository.hasCompatibilityReservation("account-1", {
        relationshipId: "relationship-outgoing",
        partnerAccountId: "account-2",
        role: "inviter",
      }),
    ).toBe(false);
    expect(
      repository.reserveIncomingCompatibilityReference("account-1", {
        relationshipId: "relationship-incoming",
        partnerAccountId: "account-2",
        createdAt: at,
      }).outcome,
    ).toBe("reserved");
    expect(
      repository.releaseCompatibilityReservation("account-1", "relationship-incoming", at),
    ).toEqual({ outcome: "released", reference: null });
  });

  it("共有D1由来のDiary循環参照を一度だけcopyして復元する", async () => {
    const legacy = createRepository();
    const target = createRepository();
    await Promise.all([legacy.initialize(), target.initialize()]);
    legacy.bindAccount("account-1");
    target.bindAccount("account-1");
    const source = await d1.action.conversation.storeLineTextSource(legacy.client, {
      accountId: "account-1",
      eventId: "legacy-event-1",
      body: "legacy private diary",
      receivedAt: new Date("2026-08-08T00:00:00.000Z"),
    });
    const turn = await d1.action.conversation.attachMessagesToTurn(
      legacy.client,
      "account-1",
      [source],
      1,
      "test-model",
      "test-prompt-v1",
    );
    await d1.action.conversation.markTurnGenerating(legacy.client, turn.turnId);
    await d1.action.conversation.saveAssistantResponse(legacy.client, {
      turnId: turn.turnId,
      body: "legacy response",
      endSession: false,
    });
    await legacy.client.insert(d1.schema.brainItems).values({
      id: "legacy-brain-1",
      accountId: "account-1",
      category: "memory",
      statement: "legacy memory",
      attributes: {},
      derivation: "ai",
      status: "active",
      stability: "stable",
      sensitivity: "normal",
      externallyShareable: false,
      confidence: { state: "uncomputed" },
    });

    const snapshot = {
      account: await legacy.client
        .select()
        .from(d1.schema.accounts)
        .where(eq(d1.schema.accounts.id, "account-1"))
        .get(),
      sourceRecords: await legacy.client.select().from(d1.schema.sourceRecords).all(),
      sourceRecordTextPayloads: await legacy.client
        .select()
        .from(d1.schema.sourceRecordTextPayloads)
        .all(),
      sourceRecordRevisions: [],
      brainItems: await legacy.client.select().from(d1.schema.brainItems).all(),
      brainItemEvidenceEdges: [],
      brainItemRevisions: [],
      brainItemAccessLabels: [],
      brainItemTopicLabels: [],
      conversationSessions: await legacy.client.select().from(d1.schema.conversationSessions).all(),
      conversationMessages: await legacy.client.select().from(d1.schema.conversationMessages).all(),
      chatTurns: await legacy.client.select().from(d1.schema.chatTurns).all(),
      diagnosisResponses: [],
      diagnosisAnswers: [],
      diagnosisDeferredQuestions: [],
      diagnosisBrainProjectionRequests: [],
      diagnosisBrainProjectionHeads: [],
    } satisfies LegacyAccountDataSnapshot;
    target.importLegacyAccountData(snapshot);
    target.importLegacyAccountData(snapshot);

    expect(target.isLegacyImportComplete()).toBe(true);
    await expect(
      d1.action.conversation.getTurnContext(target.client, turn.turnId, 20),
    ).resolves.toMatchObject({
      accountId: "account-1",
      messages: [{ body: "legacy private diary", role: "user" }],
    });
    expect(target.client.select().from(d1.schema.conversationMessages).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assistantBody: "legacy response", turnId: turn.turnId }),
      ]),
    );
    expect(await target.client.select().from(d1.schema.brainVectorSyncJobs).all()).toEqual([
      expect.objectContaining({
        brainItemId: "legacy-brain-1",
        operation: "upsert",
        status: "pending",
      }),
    ]);
  });

  it("Diagnosis回答・Source・projection requestを同じAccount SQLiteへ保存する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const at = new Date("2026-08-08T00:00:00.000Z");
    const lifecycle = { createdAt: at, updatedAt: at, deletedAt: null, isDeleted: false };
    repository.syncDiagnosisCatalog({
      questions: [{ id: "question-1", ...lifecycle }],
      questionVersions: [
        {
          questionId: "question-1",
          version: 1,
          state: "approved",
          text: "Question",
          hint: null,
          format: "single_choice",
          approvedAt: at,
          retiredAt: null,
          ...lifecycle,
        },
      ],
      questionChoices: [
        {
          questionId: "question-1",
          questionVersion: 1,
          choiceId: "yes",
          label: "Yes",
          position: 1,
          presentation: null,
          ...lifecycle,
        },
      ],
      scoringConfigs: [],
      diagnoses: [
        {
          id: "diagnosis-1",
          title: "Diagnosis",
          description: "Description",
          scoringConfigId: null,
          displayOrder: 1,
          opensAt: new Date("2026-08-01T00:00:00.000Z"),
          closesAt: null,
          state: "published",
          publishedAt: at,
          withdrawnAt: null,
          ...lifecycle,
        },
      ],
      diagnosisQuestions: [
        {
          id: "diagnosis-question-1",
          diagnosisId: "diagnosis-1",
          questionId: "question-1",
          questionVersion: 1,
          position: 1,
          ...lifecycle,
        },
      ],
    });

    const saved = await d1.action.diagnosis.saveDiagnosisAnswer(repository.client, {
      accountId: "account-1",
      diagnosisId: "diagnosis-1",
      diagnosisQuestionId: "diagnosis-question-1",
      choiceId: "yes",
      at,
    });

    expect(saved).toMatchObject({ type: "saved", progress: { responseStatus: "answered" } });
    expect(await repository.client.select().from(d1.schema.sourceRecords).all()).toHaveLength(1);
    expect(
      await repository.client.select().from(d1.schema.diagnosisBrainProjectionRequests).all(),
    ).toHaveLength(1);
  });
});
