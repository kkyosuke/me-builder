import { d1 } from "@me-builder/lib";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { avatarActions, listPendingAvatarObjectDeletions } from "./avatar";
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
      "avatar_jobs",
      "avatar_candidates",
      "avatar_profile",
      "avatar_object_deletions",
      "avatar_generation_events",
    ];
    for (const table of descendantTables) {
      expect(repository.columnNames(table), table).not.toContain("account_id");
    }
  });

  it("新規生成をAccountごとに設定された24時間上限までに制限する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const accountId = "account-1";
    const base = new Date("2026-08-09T00:00:00.000Z");
    const rateLimit = 2;

    for (let index = 0; index <= rateLimit; index += 1) {
      const at = new Date(base.getTime() + index * 60_000);
      const jobId = `rate-job-${index}`;
      await avatarActions["avatar.createJob"](repository.client, accountId, {
        id: jobId,
        referenceObjectKey: `reference-${index}.webp`,
        referenceContentType: "image/webp",
        createdAt: at,
        expiresAt: new Date(at.getTime() + 24 * 60 * 60 * 1000),
      });
      await avatarActions["avatar.finishPersonCheck"](
        repository.client,
        accountId,
        jobId,
        true,
        at,
      );
      const started = await avatarActions["avatar.startGeneration"](
        repository.client,
        accountId,
        jobId,
        rateLimit,
        at,
      );
      if (index < rateLimit) {
        expect(started).toMatchObject({ type: "accepted" });
        await avatarActions["avatar.failJob"](
          repository.client,
          accountId,
          jobId,
          "test_completed",
          at,
        );
      } else {
        expect(started).toEqual({
          type: "rate-limited",
          retryAt: new Date("2026-08-10T00:00:00.000Z"),
        });
      }
    }
  });

  it("生成上限が0ならAccount単位の回数を制限しない", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const accountId = "account-1";
    const base = new Date("2026-08-09T00:00:00.000Z");

    for (let index = 0; index < 4; index += 1) {
      const at = new Date(base.getTime() + index * 60_000);
      const jobId = `unlimited-job-${index}`;
      await avatarActions["avatar.createJob"](repository.client, accountId, {
        id: jobId,
        referenceObjectKey: `unlimited-reference-${index}.webp`,
        referenceContentType: "image/webp",
        createdAt: at,
        expiresAt: new Date(at.getTime() + 24 * 60 * 60 * 1000),
      });
      await avatarActions["avatar.finishPersonCheck"](
        repository.client,
        accountId,
        jobId,
        true,
        at,
      );

      await expect(
        avatarActions["avatar.startGeneration"](repository.client, accountId, jobId, 0, at),
      ).resolves.toMatchObject({ type: "accepted" });
      await avatarActions["avatar.failJob"](
        repository.client,
        accountId,
        jobId,
        "test_completed",
        at,
      );
    }
  });

  it("人物判定から候補選択までをAccount単位で永続化する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const accountId = "account-1";
    const createdAt = new Date("2026-08-09T00:00:00.000Z");
    const jobId = "job-1";

    const created = await avatarActions["avatar.createJob"](repository.client, accountId, {
      id: jobId,
      referenceObjectKey: "accounts/account-1/avatar/jobs/job-1/reference.webp",
      referenceContentType: "image/webp",
      createdAt,
      expiresAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect(created).toMatchObject({
      type: "created",
      job: { status: "checking", pendingOperation: "person-check", queuePending: true },
    });
    await expect(
      avatarActions["avatar.listPendingEnqueues"](repository.client, accountId, createdAt),
    ).resolves.toEqual([{ jobId, operation: "person-check" }]);

    await avatarActions["avatar.markEnqueued"](
      repository.client,
      accountId,
      jobId,
      "person-check",
      new Date("2026-08-09T00:00:01.000Z"),
    );
    const personLease = await avatarActions["avatar.acquireTask"](
      repository.client,
      accountId,
      jobId,
      "person-check",
      new Date("2026-08-09T00:10:00.000Z"),
      new Date("2026-08-09T00:00:02.000Z"),
    );
    expect(personLease).toMatchObject({ type: "acquired", job: { attemptCount: 1 } });
    await avatarActions["avatar.finishPersonCheck"](
      repository.client,
      accountId,
      jobId,
      true,
      new Date("2026-08-09T00:00:03.000Z"),
    );

    const accepted = await avatarActions["avatar.startGeneration"](
      repository.client,
      accountId,
      jobId,
      3,
      new Date("2026-08-09T00:00:04.000Z"),
    );
    expect(accepted).toMatchObject({
      type: "accepted",
      job: { status: "accepted", pendingOperation: "generate", queuePending: true },
    });
    const generationLease = await avatarActions["avatar.acquireTask"](
      repository.client,
      accountId,
      jobId,
      "generate",
      new Date("2026-08-09T00:10:05.000Z"),
      new Date("2026-08-09T00:00:05.000Z"),
    );
    expect(generationLease).toMatchObject({
      type: "acquired",
      job: { status: "generating", attemptCount: 1 },
    });

    const candidate = {
      id: "candidate-1",
      jobId,
      objectKey: "accounts/account-1/avatar/jobs/job-1/candidates/candidate-1.webp",
      contentType: "image/webp",
      createdAt: new Date("2026-08-09T00:00:06.000Z"),
      expiresAt: new Date("2026-08-16T00:00:06.000Z"),
      selectedAt: null,
    };
    await expect(
      avatarActions["avatar.addCandidate"](repository.client, accountId, candidate),
    ).resolves.toBe(true);
    await avatarActions["avatar.finishGeneration"](
      repository.client,
      accountId,
      jobId,
      "gemini-image-model",
      new Date("2026-08-09T00:00:07.000Z"),
    );
    const selected = await avatarActions["avatar.selectCandidate"](
      repository.client,
      accountId,
      candidate.id,
      0,
      new Date("2026-08-09T00:00:08.000Z"),
    );
    expect(selected).toMatchObject({
      type: "selected",
      state: {
        currentCandidate: { id: candidate.id },
        latestJob: { status: "selected" },
      },
    });
    const changeIntervalMs = 7 * 24 * 60 * 60 * 1000;
    await expect(
      avatarActions["avatar.deleteCurrent"](
        repository.client,
        accountId,
        changeIntervalMs,
        new Date("2026-08-10T00:00:08.000Z"),
      ),
    ).resolves.toEqual({
      type: "rate-limited",
      retryAt: new Date("2026-08-16T00:00:08.000Z"),
    });
    await expect(
      avatarActions["avatar.deleteCurrent"](
        repository.client,
        accountId,
        changeIntervalMs,
        new Date("2026-08-16T00:00:08.000Z"),
      ),
    ).resolves.toMatchObject({ type: "deleted", previousObjectKey: candidate.objectKey });
    await expect(
      listPendingAvatarObjectDeletions(repository.client, new Date("2026-08-17T00:00:00.000Z")),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectKey: "accounts/account-1/avatar/jobs/job-1/reference.webp",
        }),
      ]),
    );
    await expect(
      avatarActions["avatar.resolveImage"](
        repository.client,
        accountId,
        candidate.id,
        new Date("2026-08-17T00:00:00.000Z"),
      ),
    ).resolves.toEqual({
      type: "resolved",
      objectKey: candidate.objectKey,
      contentType: "image/webp",
    });
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
      brainItems: [],
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

  it("Queue投入失敗をbackoffし、受付期限を超えたらfailedへ終了する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const accountId = "account-1";
    const createdAt = new Date("2026-08-09T00:00:00.000Z");
    const expiresAt = new Date("2026-08-09T00:10:00.000Z");
    await avatarActions["avatar.createJob"](repository.client, accountId, {
      id: "enqueue-job",
      referenceObjectKey: "reference.webp",
      referenceContentType: "image/webp",
      createdAt,
      expiresAt,
    });

    await avatarActions["avatar.recordEnqueueFailure"](
      repository.client,
      accountId,
      "enqueue-job",
      "person-check",
      createdAt,
    );
    await expect(
      avatarActions["avatar.getState"](repository.client, accountId, createdAt),
    ).resolves.toMatchObject({
      latestJob: {
        status: "checking",
        queuePending: true,
        enqueueAttemptCount: 1,
        nextEnqueueAt: new Date("2026-08-09T00:00:05.000Z"),
      },
    });

    await avatarActions["avatar.recordEnqueueFailure"](
      repository.client,
      accountId,
      "enqueue-job",
      "person-check",
      expiresAt,
    );
    await expect(
      avatarActions["avatar.getState"](repository.client, accountId, expiresAt),
    ).resolves.toMatchObject({
      latestJob: {
        status: "failed",
        queuePending: false,
        enqueueAttemptCount: 2,
        errorCode: "queue_enqueue_expired",
      },
    });
    await expect(
      listPendingAvatarObjectDeletions(repository.client, expiresAt),
    ).resolves.toContainEqual(expect.objectContaining({ objectKey: "reference.webp" }));
  });

  it("有効な処理leaseは期限を返して再配送を失わない", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const accountId = "account-1";
    const createdAt = new Date("2026-08-09T00:00:00.000Z");
    const leaseExpiresAt = new Date("2026-08-09T00:10:00.000Z");
    await avatarActions["avatar.createJob"](repository.client, accountId, {
      id: "leased-job",
      referenceObjectKey: "reference.webp",
      referenceContentType: "image/webp",
      createdAt,
      expiresAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    await avatarActions["avatar.markEnqueued"](
      repository.client,
      accountId,
      "leased-job",
      "person-check",
      createdAt,
    );
    await avatarActions["avatar.acquireTask"](
      repository.client,
      accountId,
      "leased-job",
      "person-check",
      leaseExpiresAt,
      createdAt,
    );

    await expect(
      avatarActions["avatar.acquireTask"](
        repository.client,
        accountId,
        "leased-job",
        "person-check",
        new Date("2026-08-09T00:11:00.000Z"),
        new Date("2026-08-09T00:01:00.000Z"),
      ),
    ).resolves.toEqual({ type: "skip", reason: "leased", retryAt: leaseExpiresAt });
  });
});
