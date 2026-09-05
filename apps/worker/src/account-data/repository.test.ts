import {
  DO,
  PHOTO_DIARY_DELETION_DISPATCH_RECOVERY_MS,
  PROFILE_SUMMARY_DISPATCH_RECOVERY_MS,
} from "@me-builder/lib";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AccountDataRepository } from "./repository";

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

  it("dispatched checkpointの回復期限を次のmaintenanceとして返す", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const receivedAt = new Date("2026-08-08T00:00:00.000Z");
    const source = await DO.account.action.diary.storeLineTextSource(repository.client, {
      accountId: "account-1",
      eventId: "event-dispatched-maintenance",
      body: "今日は公園を散歩した",
      receivedAt,
    });
    await DO.account.action.diary.attachMessagesToTurn(
      repository.client,
      "account-1",
      [source],
      1,
      "test-model",
      "test-prompt",
    );
    const [checkpoint] = await repository.client
      .select()
      .from(DO.account.schema.diaryBrainCheckpoints);
    const dispatchedAt = new Date(receivedAt.getTime() + 10 * 60 * 1000);
    await DO.account.action.diary.claimDueDiaryBrainCheckpointIds(
      repository.client,
      "account-1",
      dispatchedAt,
    );
    await DO.account.action.diary.markDiaryBrainCheckpointDispatched(
      repository.client,
      "account-1",
      checkpoint?.id ?? "",
      dispatchedAt,
    );

    expect(repository.nextMaintenanceAt()).toBe(
      dispatchedAt.getTime() + DO.account.action.diary.DIARY_BRAIN_CHECKPOINT_DISPATCH_LEASE_MS,
    );

    await repository.client
      .update(DO.account.schema.diaryBrainCheckpoints)
      .set({ status: "failed" })
      .where(eq(DO.account.schema.diaryBrainCheckpoints.id, checkpoint?.id ?? ""));
    await repository.client
      .update(DO.account.schema.conversationSessions)
      .set({ status: "closed" })
      .where(eq(DO.account.schema.conversationSessions.accountId, "account-1"));
    expect(repository.nextMaintenanceAt()).toBeNull();
  });

  it("未配送のProfile Summary生成要求を直近のmaintenanceとして返す", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const requestedAt = new Date("2026-08-12T00:00:00.000Z");
    await repository.client.insert(DO.account.schema.profileSummaryGenerations).values({
      id: "generation-undispatched",
      accountId: "account-1",
      status: "queued",
      requestedAt,
    });

    expect(repository.nextMaintenanceAt()).toBe(
      requestedAt.getTime() + PROFILE_SUMMARY_DISPATCH_RECOVERY_MS,
    );

    await DO.account.action.profileSummary.markProfileSummaryGenerationDispatched(
      repository.client,
      "account-1",
      "generation-undispatched",
      new Date("2026-08-12T00:00:01.000Z"),
    );
    expect(repository.nextMaintenanceAt()).toBeNull();
  });

  it("AI利用予約のtimeoutをmaintenanceとして返す", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const reservedAt = new Date("2026-08-15T00:00:00.000Z");
    await DO.account.action.aiUsage.reserveAiUsage(
      repository.client,
      "account-1",
      {
        requestId: "maintenance-reservation",
        kind: "ai-reply",
        period: {
          key: "2026-08",
          start: new Date("2026-08-01T00:00:00.000Z"),
          end: new Date("2026-09-01T00:00:00.000Z"),
        },
        limit: 20,
      },
      reservedAt,
    );

    expect(repository.nextMaintenanceAt()).toBe(
      reservedAt.getTime() + DO.account.action.aiUsage.AI_USAGE_RESERVATION_TTL_MS,
    );
    await DO.account.action.aiUsage.expireAiUsageReservations(
      repository.client,
      "account-1",
      new Date(reservedAt.getTime() + DO.account.action.aiUsage.AI_USAGE_RESERVATION_TTL_MS),
    );
    expect(repository.nextMaintenanceAt()).toBeNull();
  });

  it("Queue未配送の写真削除要求を30秒後のmaintenanceとして返す", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const requestedAt = new Date("2026-08-22T01:00:00.000Z");
    const reserved = await DO.account.action.photoDiary.reservePhotoDiaryMedia(
      repository.client,
      "account-1",
      {
        webhookEventId: "event-photo-maintenance",
        lineMessageId: "message-photo-maintenance",
        mimeType: "image/jpeg",
        byteSize: 1_000,
        thumbnailByteSize: 100,
        storageByteSize: 1_100,
        width: 800,
        height: 600,
        capturedAt: requestedAt,
        storageLimitBytes: 2_000,
      },
      requestedAt,
    );
    if (reserved.type === "capacity-exceeded") throw new Error("fixture reservation failed");
    await DO.account.action.photoDiary.completePhotoDiaryMedia(
      repository.client,
      "account-1",
      reserved.media.id,
      requestedAt,
    );
    await DO.account.action.photoDiary.markPhotoDiaryDeleting(
      repository.client,
      "account-1",
      reserved.media.id,
      requestedAt,
    );

    expect(repository.nextMaintenanceAt()).toBe(
      requestedAt.getTime() + PHOTO_DIARY_DELETION_DISPATCH_RECOVERY_MS,
    );
    await DO.account.action.photoDiary.markPhotoDiaryDeletionEnqueued(
      repository.client,
      "account-1",
      reserved.media.id,
      requestedAt,
    );
    expect(repository.nextMaintenanceAt()).toBeNull();
  });

  it("別ObjectのAccount所有データをSELECTできない", async () => {
    const first = createRepository();
    const second = createRepository();
    await Promise.all([first.initialize(), second.initialize()]);
    first.bindAccount("account-1");
    second.bindAccount("account-2");

    const source = await DO.account.action.diary.storeLineTextSource(first.client, {
      accountId: "account-1",
      eventId: "event-1",
      body: "private diary",
      receivedAt: new Date("2026-08-08T00:00:00.000Z"),
    });

    expect(await second.client.select().from(DO.account.schema.sourceRecords).all()).toEqual([]);
    expect(
      await second.client
        .select()
        .from(DO.account.schema.sourceRecordTextPayloads)
        // IDを知っていても別Objectには行そのものがない。
        .where(eq(DO.account.schema.sourceRecordTextPayloads.sourceRecordId, source.sourceRecordId))
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

  it("表裏のDiagnosis Questionを依存順に同期し、回答・Source・projection requestを保存する", async () => {
    const repository = createRepository();
    await repository.initialize();
    repository.bindAccount("account-1");
    const at = new Date("2026-08-08T00:00:00.000Z");
    const lifecycle = { createdAt: at, updatedAt: at, deletedAt: null, isDeleted: false };
    repository.syncDiagnosisCatalog({
      version: 1,
      questions: [
        { id: "question-1", ...lifecycle },
        { id: "question-2", ...lifecycle },
      ],
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
        {
          questionId: "question-2",
          version: 1,
          state: "approved",
          text: "Backside question",
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
        {
          questionId: "question-2",
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
          relationshipCategory: "general",
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
          id: "diagnosis-question-2",
          diagnosisId: "diagnosis-1",
          questionId: "question-2",
          questionVersion: 1,
          position: 2,
          backsideOfDiagnosisQuestionId: "diagnosis-question-1",
          ...lifecycle,
        },
        {
          id: "diagnosis-question-1",
          diagnosisId: "diagnosis-1",
          questionId: "question-1",
          questionVersion: 1,
          position: 1,
          backsideOfDiagnosisQuestionId: null,
          ...lifecycle,
        },
      ],
    });

    expect(
      await repository.client
        .select({
          id: DO.account.schema.diagnosisQuestions.id,
          backsideOfDiagnosisQuestionId:
            DO.account.schema.diagnosisQuestions.backsideOfDiagnosisQuestionId,
        })
        .from(DO.account.schema.diagnosisQuestions)
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { id: "diagnosis-question-1", backsideOfDiagnosisQuestionId: null },
        {
          id: "diagnosis-question-2",
          backsideOfDiagnosisQuestionId: "diagnosis-question-1",
        },
      ]),
    );

    const savedFront = await DO.account.action.diagnosis.saveDiagnosisAnswer(repository.client, {
      accountId: "account-1",
      diagnosisId: "diagnosis-1",
      diagnosisQuestionId: "diagnosis-question-1",
      choiceId: "yes",
      at,
    });
    expect(savedFront).toMatchObject({
      type: "saved",
      progress: { responseStatus: "in-progress" },
    });

    const savedBack = await DO.account.action.diagnosis.saveDiagnosisAnswer(repository.client, {
      accountId: "account-1",
      diagnosisId: "diagnosis-1",
      diagnosisQuestionId: "diagnosis-question-2",
      choiceId: "yes",
      at,
    });

    expect(savedBack).toMatchObject({ type: "saved", progress: { responseStatus: "answered" } });
    expect(
      await repository.client.select().from(DO.account.schema.sourceRecords).all(),
    ).toHaveLength(2);
    expect(
      await repository.client
        .select()
        .from(DO.account.schema.diagnosisBrainProjectionRequests)
        .all(),
    ).toHaveLength(2);
  });
});
