import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import { saveBrainItem } from "./brain";
import {
  DIARY_BRAIN_CHECKPOINT_DISPATCH_LEASE_MS,
  applyDiaryBrainCheckpoint,
  attachMessagesToTurn,
  claimDueDiaryBrainCheckpointIds,
  closeTurnSession,
  getDiaryBrainCheckpointContext,
  getDiaryBrainCheckpointDevelopmentNotification,
  getPendingAssistantResponse,
  getTurnContext,
  listDueDiaryBrainCheckpointIds,
  markDiaryBrainCheckpointDevelopmentNotificationSent,
  markDiaryBrainCheckpointDispatched,
  markTurnDelivered,
  markTurnFailed,
  markTurnGenerating,
  saveAssistantResponse,
  storeLineTextSource,
} from "./diary";

function createTestDb(): AccountDataDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: D1用migrationをSQLite integration testへ適用する
  migrate(db as any, {
    migrationsFolder: path.resolve(__dirname, "../../../../drizzle-do-account"),
  });
  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      const results = [];
      for (const query of queries) results.push(await query);
      return results;
    },
    writable: true,
  });
  return db as unknown as AccountDataDatabase;
}

/** DOがObject identityを固定する動作を、testでも同じ1行で再現する。 */
async function bindAccount(db: AccountDataDatabase, accountId: string) {
  await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId });
  return { id: accountId };
}

describe("Diary conversation persistence flow", () => {
  it("LINE原本の保存からTurn配送完了とSession終了まで冪等に処理する", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-diary_e2e");
    const firstReceivedAt = new Date("2026-08-07T00:00:00.000Z");
    const secondReceivedAt = new Date("2026-08-07T00:00:01.000Z");
    const first = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "event-1",
      body: "今日は少し疲れた",
      receivedAt: firstReceivedAt,
    });
    const second = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "event-2",
      body: "それでも散歩できた",
      receivedAt: secondReceivedAt,
    });

    await expect(
      storeLineTextSource(db, {
        accountId: account.id,
        eventId: "event-1",
        body: "再配送で書き換えられてはいけない本文",
        receivedAt: firstReceivedAt,
      }),
    ).resolves.toEqual(first);
    const attached = await attachMessagesToTurn(
      db,
      account.id,
      [second, first],
      1,
      "test-model",
      "test-prompt",
    );
    await expect(
      attachMessagesToTurn(db, account.id, [first, second], 1, "test-model", "test-prompt"),
    ).resolves.toEqual(attached);
    expect(await db.select().from(schema.chatTurns)).toEqual([
      expect.objectContaining({ promptVersion: "test-prompt" }),
    ]);

    const context = await getTurnContext(db, attached.turnId, 20);
    expect(context).toMatchObject({
      accountId: account.id,
      messages: [
        { role: "user", body: "今日は少し疲れた", sequence: 1, recordedAt: firstReceivedAt },
        {
          role: "user",
          body: "それでも散歩できた",
          sequence: 2,
          recordedAt: secondReceivedAt,
        },
      ],
    });
    expect(context?.currentUserMessageIds).toEqual(context?.messages.map(({ id }) => id));

    await expect(markTurnGenerating(db, attached.turnId)).resolves.toBe(true);
    const responseMessageId = await saveAssistantResponse(db, account.id, {
      turnId: attached.turnId,
      body: "疲れている中でも散歩できたことを記録したよ。今は少し休めそう？",
      endSession: true,
    });
    await expect(
      saveAssistantResponse(db, account.id, {
        turnId: attached.turnId,
        body: "再試行で重複保存されてはいけない応答",
        endSession: true,
      }),
    ).resolves.toBe(responseMessageId);
    await expect(getPendingAssistantResponse(db, account.id, attached.turnId)).resolves.toEqual({
      body: "疲れている中でも散歩できたことを記録したよ。今は少し休めそう？",
      endSession: true,
      usedBrainItems: [],
    });
    await expect(db.select().from(schema.brainItems)).resolves.toHaveLength(0);
    await expect(
      listDueDiaryBrainCheckpointIds(db, account.id, new Date(firstReceivedAt.getTime() - 1)),
    ).resolves.toEqual([]);
    const [checkpoint] = await db.select().from(schema.diaryBrainCheckpoints);
    expect(checkpoint).toMatchObject({
      sessionId: attached.sessionId,
      fromSequence: 1,
      throughSequence: 2,
      status: "pending",
    });
    await expect(listDueDiaryBrainCheckpointIds(db, account.id, new Date())).resolves.toEqual([
      checkpoint?.id,
    ]);
    await expect(claimDueDiaryBrainCheckpointIds(db, account.id, new Date())).resolves.toEqual([
      checkpoint?.id,
    ]);
    await expect(
      markDiaryBrainCheckpointDispatched(db, account.id, checkpoint?.id ?? ""),
    ).resolves.toBe(true);
    await expect(listDueDiaryBrainCheckpointIds(db, account.id, new Date())).resolves.toEqual([]);
    const checkpointContext = await getDiaryBrainCheckpointContext(
      db,
      account.id,
      checkpoint?.id ?? "",
    );
    expect(checkpointContext?.messages.every(({ role }) => role === "user")).toBe(true);
    await expect(
      applyDiaryBrainCheckpoint(
        db,
        account.id,
        checkpoint?.id ?? "",
        (checkpointContext?.throughSequence ?? 0) - 1,
        "diary-brain-test",
        [],
      ),
    ).resolves.toBe(false);
    await expect(
      applyDiaryBrainCheckpoint(
        db,
        account.id,
        checkpoint?.id ?? "",
        checkpointContext?.throughSequence ?? 0,
        "diary-brain-test",
        [
          {
            category: "memory",
            statement: "範囲外の根拠",
            sourceMessageIds: ["outside-message"],
          },
        ],
      ),
    ).rejects.toThrow("evidence validation failed");
    await expect(
      applyDiaryBrainCheckpoint(
        db,
        account.id,
        checkpoint?.id ?? "",
        checkpointContext?.throughSequence ?? 0,
        "diary-brain-test",
        [
          {
            category: "memory",
            statement: "発言していない出来事",
            sourceMessageIds: checkpointContext?.sourceMessageIds.slice(0, 1) ?? [],
          },
        ],
      ),
    ).rejects.toThrow("evidence validation failed");
    await expect(db.select().from(schema.brainItems)).resolves.toHaveLength(0);
    expect(
      db
        .select({ status: schema.diaryBrainCheckpoints.status })
        .from(schema.diaryBrainCheckpoints)
        .where(eq(schema.diaryBrainCheckpoints.id, checkpoint?.id ?? ""))
        .get(),
    ).toEqual({ status: "dispatched" });
    await expect(
      applyDiaryBrainCheckpoint(
        db,
        account.id,
        checkpoint?.id ?? "",
        checkpointContext?.throughSequence ?? 0,
        "diary-brain-test",
        [
          {
            category: "memory",
            statement: "今日は少し疲れた",
            sourceMessageIds: checkpointContext?.sourceMessageIds.slice(0, 1) ?? [],
          },
          {
            category: "memory",
            statement: "散歩できた",
            sourceMessageIds: checkpointContext?.sourceMessageIds.slice(1, 2) ?? [],
          },
          {
            category: "memory",
            statement: " 今日は少し疲れた ",
            sourceMessageIds: checkpointContext?.sourceMessageIds.slice(0, 1) ?? [],
          },
        ],
      ),
    ).resolves.toEqual({
      candidates: [
        {
          category: "memory",
          statement: "今日は少し疲れた",
          sourceMessageIds: checkpointContext?.sourceMessageIds.slice(0, 1) ?? [],
          operation: "created",
          deduplication: "none",
        },
        {
          category: "memory",
          statement: "散歩できた",
          sourceMessageIds: checkpointContext?.sourceMessageIds.slice(1, 2) ?? [],
          operation: "created",
          deduplication: "none",
        },
      ],
    });
    await expect(db.select().from(schema.brainItems)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: account.id,
          category: "memory",
          statement: "今日は少し疲れた",
          attributes: expect.objectContaining({
            temporalContext: expect.objectContaining({
              originalStatement: "今日は少し疲れた",
              anchorDate: "2026-08-07",
              timeZone: "Asia/Tokyo",
            }),
          }),
          derivation: "ai",
          status: "active",
        }),
        expect.objectContaining({
          accountId: account.id,
          category: "memory",
          statement: "散歩できた",
          derivation: "ai",
          status: "active",
        }),
      ]),
    );
    await expect(db.select().from(schema.brainItems)).resolves.toHaveLength(2);
    await expect(db.select().from(schema.brainItemEvidenceEdges)).resolves.toHaveLength(2);
    await expect(db.select().from(schema.brainItemAccessLabels)).resolves.toHaveLength(2);
    await expect(db.select().from(schema.diaryBrainCheckpointItems)).resolves.toHaveLength(2);
    await expect(
      getDiaryBrainCheckpointDevelopmentNotification(db, account.id, checkpoint?.id ?? ""),
    ).resolves.toEqual({
      candidates: [
        {
          category: "memory",
          statement: "今日は少し疲れた",
          sourceMessageIds: checkpointContext?.sourceMessageIds.slice(0, 1) ?? [],
          operation: "created",
          deduplication: "none",
        },
        {
          category: "memory",
          statement: "散歩できた",
          sourceMessageIds: checkpointContext?.sourceMessageIds.slice(1, 2) ?? [],
          operation: "created",
          deduplication: "none",
        },
      ],
    });
    await expect(
      markDiaryBrainCheckpointDevelopmentNotificationSent(db, account.id, checkpoint?.id ?? ""),
    ).resolves.toBe(true);
    await expect(
      getDiaryBrainCheckpointDevelopmentNotification(db, account.id, checkpoint?.id ?? ""),
    ).resolves.toBeUndefined();
    await expect(markTurnDelivered(db, attached.turnId)).resolves.toBe(true);
    await expect(markTurnFailed(db, attached.turnId, "stale_delivery_failure")).resolves.toBe(
      false,
    );
    await expect(markTurnGenerating(db, attached.turnId)).resolves.toBe(false);
    await closeTurnSession(db, attached.turnId);

    const storedTurn = await db
      .select()
      .from(schema.chatTurns)
      .where(eq(schema.chatTurns.id, attached.turnId))
      .get();
    expect(storedTurn).toMatchObject({ status: "delivered", responseMessageId });
    const storedSession = await db
      .select()
      .from(schema.conversationSessions)
      .where(eq(schema.conversationSessions.id, attached.sessionId))
      .get();
    expect(storedSession).toMatchObject({
      status: "closed",
      closeReason: "explicit",
      nextSequence: 4,
    });
    expect(await db.select().from(schema.conversationMessages)).toHaveLength(3);
    expect(await db.select().from(schema.sourceRecordTextPayloads)).toMatchObject([
      { body: "今日は少し疲れた" },
      { body: "それでも散歩できた" },
    ]);
  });

  it("Memory以外の分類と相対日付を解決したstatementを保存する", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-diary_category_e2e");
    const source = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "event-goal",
      body: "来月までに転職先を決めたい",
      receivedAt: new Date("2026-08-11T03:00:00.000Z"),
    });
    await attachMessagesToTurn(db, account.id, [source], 1, "test-model", "test-prompt");
    const [checkpoint] = await db.select().from(schema.diaryBrainCheckpoints);
    await claimDueDiaryBrainCheckpointIds(db, account.id, new Date("2026-08-11T03:30:00.000Z"));
    await markDiaryBrainCheckpointDispatched(db, account.id, checkpoint?.id ?? "");
    const context = await getDiaryBrainCheckpointContext(db, account.id, checkpoint?.id ?? "");

    await expect(
      applyDiaryBrainCheckpoint(
        db,
        account.id,
        checkpoint?.id ?? "",
        context?.throughSequence ?? 0,
        "diary-brain-v2",
        [
          {
            category: "goal",
            statement: "来月までに転職先を決めたい",
            sourceMessageIds: context?.sourceMessageIds ?? [],
          },
        ],
      ),
    ).resolves.toEqual({
      candidates: [
        {
          category: "goal",
          statement: "来月までに転職先を決めたい",
          sourceMessageIds: context?.sourceMessageIds ?? [],
          operation: "created",
          deduplication: "none",
        },
      ],
    });
    await expect(db.select().from(schema.brainItems)).resolves.toEqual([
      expect.objectContaining({
        category: "goal",
        statement: "来月までに転職先を決めたい",
        stability: "temporary",
        attributes: expect.objectContaining({
          promptVersion: "diary-brain-v2",
          temporalContext: {
            originalStatement: "来月までに転職先を決めたい",
            anchorDate: "2026-08-11",
            timeZone: "Asia/Tokyo",
            resolutions: [{ original: "来月", resolved: "2026年9月" }],
          },
        }),
      }),
    ]);
  });

  it("意味的に同じ既存Itemへ新しいEvidenceだけを追加する", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-diary_brain_dedup");
    const existingAt = new Date("2026-08-01T00:00:00Z");
    const existingSource = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "dedup-existing-source",
      body: "辛い食べ物が苦手",
      receivedAt: existingAt,
    });
    await saveBrainItem(db, {
      at: existingAt,
      item: {
        id: "existing-preference",
        accountId: account.id,
        category: "preference",
        statement: "辛い食べ物が苦手",
        attributes: { sourceKind: "diary", isInference: false },
        derivation: "ai",
        status: "active",
        stability: "changeable",
        sensitivity: "normal",
        externallyShareable: false,
        confidence: { state: "uncomputed" },
      },
      evidence: [
        {
          id: "existing-evidence",
          sourceRecordId: existingSource.sourceRecordId,
          relation: "supports",
          isDerivationTrigger: true,
          derivationMethod: "ai",
          generatedAt: existingAt,
        },
      ],
      accessLabels: [{ id: "existing-access", label: "unclassified", assignedBy: "system" }],
      topicLabels: [{ id: "existing-topic", label: "diary" }],
    });

    const receivedAt = new Date("2026-08-11T03:00:00Z");
    const newSource = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "dedup-new-source",
      body: "辛いものはあまり食べられない",
      receivedAt,
    });
    await attachMessagesToTurn(db, account.id, [newSource], 1, "test-model", "test-prompt");
    const [checkpoint] = await db.select().from(schema.diaryBrainCheckpoints);
    await claimDueDiaryBrainCheckpointIds(
      db,
      account.id,
      new Date(receivedAt.getTime() + 11 * 60 * 1000),
    );
    await markDiaryBrainCheckpointDispatched(db, account.id, checkpoint?.id ?? "");
    const context = await getDiaryBrainCheckpointContext(db, account.id, checkpoint?.id ?? "");

    await expect(
      applyDiaryBrainCheckpoint(
        db,
        account.id,
        checkpoint?.id ?? "",
        context?.throughSequence ?? 0,
        "diary-brain-v2",
        [
          {
            category: "preference",
            statement: "辛いものはあまり食べられない",
            sourceMessageIds: context?.sourceMessageIds ?? [],
            matchingBrainItemId: "existing-preference",
            deduplication: "semantic",
          },
        ],
        receivedAt,
      ),
    ).rejects.toThrow("Diary Brain candidate validation failed");

    await expect(
      applyDiaryBrainCheckpoint(
        db,
        account.id,
        checkpoint?.id ?? "",
        context?.throughSequence ?? 0,
        "diary-brain-v2",
        [
          {
            category: "preference",
            statement: "辛いものはあまり食べられない",
            sourceMessageIds: context?.sourceMessageIds ?? [],
            matchingBrainItemId: "missing-preference",
            deduplication: "semantic",
            dedupPromptVersion: "brain-dedup-v1",
          },
        ],
        receivedAt,
      ),
    ).rejects.toThrow("Diary Brain requested match revalidation failed");
    await expect(db.select().from(schema.brainItems)).resolves.toHaveLength(1);
    await expect(db.select().from(schema.brainItemEvidenceEdges)).resolves.toHaveLength(1);

    await expect(
      applyDiaryBrainCheckpoint(
        db,
        account.id,
        checkpoint?.id ?? "",
        context?.throughSequence ?? 0,
        "diary-brain-v2",
        [
          {
            category: "preference",
            statement: "辛いものはあまり食べられない",
            sourceMessageIds: context?.sourceMessageIds ?? [],
            matchingBrainItemId: "existing-preference",
            deduplication: "semantic",
            dedupPromptVersion: "brain-dedup-v1",
          },
        ],
        receivedAt,
      ),
    ).resolves.toEqual({
      candidates: [
        {
          category: "preference",
          statement: "辛い食べ物が苦手",
          sourceMessageIds: context?.sourceMessageIds ?? [],
          operation: "evidence_added",
          deduplication: "semantic",
        },
      ],
    });
    await expect(db.select().from(schema.brainItems)).resolves.toHaveLength(1);
    await expect(db.select().from(schema.brainItemEvidenceEdges)).resolves.toEqual([
      expect.objectContaining({ id: "existing-evidence", isDerivationTrigger: true }),
      expect.objectContaining({
        brainItemId: "existing-preference",
        sourceRecordId: newSource.sourceRecordId,
        isDerivationTrigger: false,
      }),
    ]);
    await expect(db.select().from(schema.brainVectorSyncJobs)).resolves.toHaveLength(1);
    await expect(db.select().from(schema.diaryBrainCheckpointItems)).resolves.toEqual([
      expect.objectContaining({
        brainItemId: "existing-preference",
        operation: "evidence_added",
        deduplication: "semantic",
        dedupPromptVersion: "brain-dedup-v1",
      }),
    ]);
    await expect(
      getDiaryBrainCheckpointDevelopmentNotification(db, account.id, checkpoint?.id ?? ""),
    ).resolves.toEqual({
      candidates: [
        {
          category: "preference",
          statement: "辛い食べ物が苦手",
          sourceMessageIds: context?.sourceMessageIds ?? [],
          operation: "evidence_added",
          deduplication: "semantic",
        },
      ],
    });
  });

  it("回答で実際に使ったBrain ItemとEvidenceを応答と同じbatchで監査保存する", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-diary_brain_audit");
    const receivedAt = new Date("2026-08-07T00:00:00.000Z");
    const source = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "brain-audit-source",
      body: "公園を歩くと落ち着いた",
      receivedAt,
    });
    const turn = await attachMessagesToTurn(
      db,
      account.id,
      [source],
      1,
      "test-model",
      "test-prompt",
    );
    await db.insert(schema.brainItems).values({
      id: "brain-audit-item",
      accountId: account.id,
      category: "memory",
      statement: "公園を歩くと落ち着いた",
      attributes: {},
      derivation: "ai",
      status: "active",
      stability: "stable",
      sensitivity: "normal",
      externallyShareable: false,
      confidence: { state: "uncomputed" },
      createdAt: receivedAt,
      updatedAt: receivedAt,
    });
    await db.batch([
      db.insert(schema.brainItemEvidenceEdges).values({
        id: "brain-audit-evidence",
        brainItemId: "brain-audit-item",
        sourceRecordId: source.sourceRecordId,
        relation: "supports",
        isDerivationTrigger: true,
        derivationMethod: "ai",
        generatedAt: receivedAt,
        createdAt: receivedAt,
        updatedAt: receivedAt,
      }),
      db.insert(schema.brainItemAccessLabels).values({
        id: "brain-audit-access",
        brainItemId: "brain-audit-item",
        label: "unclassified",
        assignedBy: "system",
        createdAt: receivedAt,
        updatedAt: receivedAt,
      }),
    ]);
    await markTurnGenerating(db, turn.turnId);

    await saveAssistantResponse(db, account.id, {
      turnId: turn.turnId,
      body: "以前と同じように、公園を少し歩く選択肢もありそうです。",
      endSession: false,
      brainUsages: [{ brainItemId: "brain-audit-item", sourceRecordIds: [source.sourceRecordId] }],
    });

    await expect(getPendingAssistantResponse(db, account.id, turn.turnId)).resolves.toEqual({
      body: "以前と同じように、公園を少し歩く選択肢もありそうです。",
      endSession: false,
      usedBrainItems: [{ category: "memory", statement: "公園を歩くと落ち着いた" }],
    });

    await expect(db.select().from(schema.diaryChatBrainUsageAudits)).resolves.toEqual([
      expect.objectContaining({
        turnId: turn.turnId,
        brainItemId: "brain-audit-item",
        purpose: "diary_chat",
        status: "active",
        derivation: "ai",
        confidence: { state: "uncomputed" },
        accessLabels: ["unclassified"],
        sourceRecordIds: [source.sourceRecordId],
      }),
    ]);
  });

  it("異なるSessionへ保存済みのeventがまとめて再送されても新しいTurnを作らない", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-session_boundary");
    const first = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "old-session-event",
      body: "ここで一度終わります",
      receivedAt: new Date("2026-08-07T00:00:00.000Z"),
    });
    const firstTurn = await attachMessagesToTurn(
      db,
      account.id,
      [first],
      1,
      "test-model",
      "test-prompt",
    );
    await closeTurnSession(db, firstTurn.turnId);

    const second = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "new-session-event",
      body: "新しい会話を始めます",
      receivedAt: new Date("2026-08-07T00:01:00.000Z"),
    });
    const secondTurn = await attachMessagesToTurn(
      db,
      account.id,
      [second],
      2,
      "test-model",
      "test-prompt",
    );
    expect(secondTurn.sessionId).not.toBe(firstTurn.sessionId);
    await expect(markTurnGenerating(db, secondTurn.turnId)).resolves.toBe(true);
    await expect(markTurnFailed(db, secondTurn.turnId, "generation_exhausted")).resolves.toBe(true);
    await expect(markTurnDelivered(db, secondTurn.turnId)).resolves.toBe(false);

    await expect(
      attachMessagesToTurn(db, account.id, [first, second], 3, "test-model", "test-prompt"),
    ).resolves.toEqual(firstTurn);
    expect(await db.select().from(schema.chatTurns)).toHaveLength(2);
  });

  it("複数messageからなる既存Turnの一部だけが再送されても新しいTurnを作らない", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-partial_turn_replay");
    const first = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "coalesced-event-1",
      body: "一つ目",
      receivedAt: new Date("2026-08-07T00:00:00.000Z"),
    });
    const second = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "coalesced-event-2",
      body: "二つ目",
      receivedAt: new Date("2026-08-07T00:00:01.000Z"),
    });
    const originalTurn = await attachMessagesToTurn(
      db,
      account.id,
      [first, second],
      1,
      "test-model",
      "test-prompt",
    );

    await expect(
      attachMessagesToTurn(db, account.id, [first], 2, "test-model", "test-prompt"),
    ).resolves.toEqual(originalTurn);
    expect(await db.select().from(schema.chatTurns)).toHaveLength(1);
  });

  it("保存済みeventと未保存eventが混在した場合は未保存分だけを新Turnへattachする", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-partial_replay");
    const existing = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "existing-event",
      body: "保存済みのメッセージ",
      receivedAt: new Date("2026-08-07T00:00:00.000Z"),
    });
    const existingTurn = await attachMessagesToTurn(
      db,
      account.id,
      [existing],
      1,
      "test-model",
      "test-prompt",
    );
    const fresh = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "fresh-event",
      body: "新着メッセージ",
      receivedAt: new Date("2026-08-07T00:00:02.000Z"),
    });

    const freshTurn = await attachMessagesToTurn(
      db,
      account.id,
      [existing, fresh],
      2,
      "test-model",
      "test-prompt",
    );

    expect(freshTurn.turnId).not.toBe(existingTurn.turnId);
    expect(freshTurn.generationEpoch).toBe(2);
    const context = await getTurnContext(db, freshTurn.turnId, 20);
    expect(context?.currentUserMessageIds).toHaveLength(1);
    expect(context?.messages.at(-1)?.body).toBe("新着メッセージ");
    expect(await db.select().from(schema.conversationMessages)).toHaveLength(2);
  });

  it("配送済み応答への次のuser messageをSessionの返信実績として数える", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-policy_reply");
    const first = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "policy-event-1",
      body: "今日は少し疲れた",
      receivedAt: new Date("2026-08-07T00:00:00.000Z"),
    });
    const firstTurn = await attachMessagesToTurn(
      db,
      account.id,
      [first],
      1,
      "test-model",
      "test-prompt",
      ["reflective"],
    );
    await markTurnGenerating(db, firstTurn.turnId);
    await saveAssistantResponse(db, account.id, {
      turnId: firstTurn.turnId,
      body: "疲れた一日だったんだね。",
      endSession: false,
    });
    await expect(
      Promise.all([
        markTurnDelivered(db, firstTurn.turnId),
        markTurnDelivered(db, firstTurn.turnId),
      ]),
    ).resolves.toEqual([true, true]);

    expect(
      await db
        .select()
        .from(schema.conversationSessions)
        .where(eq(schema.conversationSessions.id, firstTurn.sessionId))
        .get(),
    ).toMatchObject({
      conversationPolicyId: "reflective",
      replyOpportunityCount: 1,
      replyCount: 0,
      awaitingReply: true,
    });

    const reply = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "policy-event-2",
      body: "うん、でも少し休めた",
      receivedAt: new Date("2026-08-07T00:01:00.000Z"),
    });
    const replyTurn = await attachMessagesToTurn(
      db,
      account.id,
      [reply],
      2,
      "test-model",
      "test-prompt",
      ["reflective"],
    );

    expect(replyTurn.sessionId).toBe(firstTurn.sessionId);
    expect(await getTurnContext(db, replyTurn.turnId, 20)).toMatchObject({
      conversationPolicyId: "reflective",
    });
    expect(
      await db
        .select()
        .from(schema.conversationSessions)
        .where(eq(schema.conversationSessions.id, firstTurn.sessionId))
        .get(),
    ).toMatchObject({
      replyOpportunityCount: 1,
      replyCount: 1,
      awaitingReply: false,
    });
  });

  it("発言が続いても最初の未処理発言から30分でBrain checkpointを起動する", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-brain_hard_cap");
    const startedAt = new Date("2026-08-07T00:00:00.000Z");
    const offsets = [0, 9, 18, 27];

    for (const [index, offsetMinutes] of offsets.entries()) {
      const source = await storeLineTextSource(db, {
        accountId: account.id,
        eventId: `brain-hard-cap-${index}`,
        body: `発言${index + 1}`,
        receivedAt: new Date(startedAt.getTime() + offsetMinutes * 60 * 1000),
      });
      await attachMessagesToTurn(db, account.id, [source], index + 1, "test-model", "test-prompt");
    }

    await expect(
      listDueDiaryBrainCheckpointIds(
        db,
        account.id,
        new Date(startedAt.getTime() + 30 * 60 * 1000 - 1),
      ),
    ).resolves.toEqual([]);
    const [checkpoint] = await db.select().from(schema.diaryBrainCheckpoints);
    await expect(
      listDueDiaryBrainCheckpointIds(
        db,
        account.id,
        new Date(startedAt.getTime() + 30 * 60 * 1000),
      ),
    ).resolves.toEqual([checkpoint?.id]);
    expect(checkpoint).toMatchObject({
      fromSequence: 1,
      throughSequence: 4,
      dueAt: new Date(startedAt.getTime() + 30 * 60 * 1000),
    });

    const lateSource = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "brain-hard-cap-late",
      body: "発言5",
      receivedAt: new Date(startedAt.getTime() + 31 * 60 * 1000),
    });
    await attachMessagesToTurn(db, account.id, [lateSource], 5, "test-model", "test-prompt");

    await expect(
      db
        .select()
        .from(schema.diaryBrainCheckpoints)
        .orderBy(schema.diaryBrainCheckpoints.createdAt),
    ).resolves.toEqual([
      expect.objectContaining({
        id: checkpoint?.id,
        fromSequence: 1,
        throughSequence: 4,
        status: "queued",
      }),
      expect.objectContaining({
        fromSequence: 5,
        throughSequence: 5,
        status: "pending",
      }),
    ]);

    const claimedAt = new Date(startedAt.getTime() + 31 * 60 * 1000);
    await expect(claimDueDiaryBrainCheckpointIds(db, account.id, claimedAt)).resolves.toEqual([
      checkpoint?.id,
    ]);
    await expect(
      markDiaryBrainCheckpointDispatched(db, account.id, checkpoint?.id ?? "", claimedAt),
    ).resolves.toBe(true);
    await expect(
      listDueDiaryBrainCheckpointIds(
        db,
        account.id,
        new Date(startedAt.getTime() + 40 * 60 * 1000),
      ),
    ).resolves.toEqual([]);
  });

  it("1つの取込batchが複数の期限をまたいでもcheckpoint境界を保つ", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-brain_batch_boundaries");
    const startedAt = new Date("2026-08-07T00:00:00.000Z");
    const sources = [];
    for (const [index, offsetMinutes] of [0, 11, 42].entries()) {
      sources.push(
        await storeLineTextSource(db, {
          accountId: account.id,
          eventId: `brain-batch-boundary-${index}`,
          body: `発言${index + 1}`,
          receivedAt: new Date(startedAt.getTime() + offsetMinutes * 60 * 1000),
        }),
      );
    }

    await attachMessagesToTurn(db, account.id, sources, 1, "test-model", "test-prompt");

    await expect(
      db
        .select()
        .from(schema.diaryBrainCheckpoints)
        .orderBy(schema.diaryBrainCheckpoints.fromSequence),
    ).resolves.toEqual([
      expect.objectContaining({ fromSequence: 1, throughSequence: 1, status: "queued" }),
      expect.objectContaining({ fromSequence: 2, throughSequence: 2, status: "queued" }),
      expect.objectContaining({ fromSequence: 3, throughSequence: 3, status: "pending" }),
    ]);
  });

  it("10件のuser messageごとにcheckpointを分割して入力を有界にする", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-brain_message_boundary");
    const startedAt = new Date("2026-08-07T00:00:00.000Z");
    for (let index = 0; index < 11; index += 1) {
      const source = await storeLineTextSource(db, {
        accountId: account.id,
        eventId: `brain-message-boundary-${index}`,
        body: `発言${index + 1}`,
        receivedAt: new Date(startedAt.getTime() + index * 1000),
      });
      const turn = await attachMessagesToTurn(
        db,
        account.id,
        [source],
        index + 1,
        "test-model",
        "test-prompt",
      );
      await markTurnGenerating(db, turn.turnId);
      await saveAssistantResponse(db, account.id, {
        turnId: turn.turnId,
        body: `応答${index + 1}`,
        endSession: false,
      });
    }

    await expect(
      db
        .select()
        .from(schema.diaryBrainCheckpoints)
        .orderBy(schema.diaryBrainCheckpoints.fromSequence),
    ).resolves.toEqual([
      expect.objectContaining({
        fromSequence: 1,
        throughSequence: 19,
        status: "queued",
        nextAttemptAt: new Date(startedAt.getTime() + 10 * 1000),
      }),
      expect.objectContaining({ fromSequence: 21, throughSequence: 21, status: "pending" }),
    ]);
  });

  it("削除済み・上限超過のSource RecordをBrain変換の入力とEvidence候補から除外する", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-brain_deleted_source");
    const receivedAt = new Date("2026-08-07T00:00:00.000Z");
    const source = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "brain-deleted-source",
      body: "削除後はAIへ渡さない本文",
      receivedAt,
    });
    const firstTurn = await attachMessagesToTurn(
      db,
      account.id,
      [source],
      1,
      "test-model",
      "test-prompt",
    );
    await markTurnGenerating(db, firstTurn.turnId);
    await saveAssistantResponse(db, account.id, {
      turnId: firstTurn.turnId,
      body: "削除対象の内容を含むassistant応答",
      endSession: false,
    });
    const retainedSource = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "brain-retained-source",
      body: "残す発言",
      receivedAt: new Date(receivedAt.getTime() + 60 * 1000),
    });
    await attachMessagesToTurn(db, account.id, [retainedSource], 2, "test-model", "test-prompt");
    const oversizedSource = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "brain-oversized-source",
      body: "長".repeat(5_001),
      receivedAt: new Date(receivedAt.getTime() + 2 * 60 * 1000),
    });
    await attachMessagesToTurn(db, account.id, [oversizedSource], 3, "test-model", "test-prompt");
    await db
      .update(schema.sourceRecords)
      .set({ isDeleted: true, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.sourceRecords.id, source.sourceRecordId));
    const [checkpoint] = await db.select().from(schema.diaryBrainCheckpoints);
    const claimedAt = new Date(receivedAt.getTime() + 12 * 60 * 1000);
    await claimDueDiaryBrainCheckpointIds(db, account.id, claimedAt);
    await markDiaryBrainCheckpointDispatched(db, account.id, checkpoint?.id ?? "", claimedAt);

    await expect(
      getDiaryBrainCheckpointContext(db, account.id, checkpoint?.id ?? ""),
    ).resolves.toMatchObject({
      messages: [expect.objectContaining({ role: "user", body: "残す発言" })],
    });
  });

  it("最後の発言から10分間新着がなければBrain checkpointを起動する", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-brain_inactivity");
    const receivedAt = new Date("2026-08-07T00:00:00.000Z");
    const source = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "brain-inactivity-1",
      body: "今日は公園を散歩した",
      receivedAt,
    });
    await attachMessagesToTurn(db, account.id, [source], 1, "test-model", "test-prompt");
    const [checkpoint] = await db.select().from(schema.diaryBrainCheckpoints);

    await expect(
      listDueDiaryBrainCheckpointIds(
        db,
        account.id,
        new Date(receivedAt.getTime() + 10 * 60 * 1000 - 1),
      ),
    ).resolves.toEqual([]);
    await expect(
      listDueDiaryBrainCheckpointIds(
        db,
        account.id,
        new Date(receivedAt.getTime() + 10 * 60 * 1000),
      ),
    ).resolves.toEqual([checkpoint?.id]);
    const firstClaimAt = new Date(receivedAt.getTime() + 10 * 60 * 1000);
    await expect(claimDueDiaryBrainCheckpointIds(db, account.id, firstClaimAt)).resolves.toEqual([
      checkpoint?.id,
    ]);
    await expect(
      listDueDiaryBrainCheckpointIds(
        db,
        account.id,
        new Date(firstClaimAt.getTime() + 30 * 1000 - 1),
      ),
    ).resolves.toEqual([]);
    const secondClaimAt = new Date(firstClaimAt.getTime() + 30 * 1000);
    await expect(claimDueDiaryBrainCheckpointIds(db, account.id, secondClaimAt)).resolves.toEqual([
      checkpoint?.id,
    ]);
    const retried = await db
      .select()
      .from(schema.diaryBrainCheckpoints)
      .where(eq(schema.diaryBrainCheckpoints.id, checkpoint?.id ?? ""))
      .get();
    expect(retried).toMatchObject({
      status: "queued",
      attemptCount: 2,
      nextAttemptAt: new Date(secondClaimAt.getTime() + 60 * 1000),
    });
    await expect(
      markDiaryBrainCheckpointDispatched(db, account.id, checkpoint?.id ?? "", secondClaimAt),
    ).resolves.toBe(true);
    await expect(
      listDueDiaryBrainCheckpointIds(
        db,
        account.id,
        new Date(secondClaimAt.getTime() + DIARY_BRAIN_CHECKPOINT_DISPATCH_LEASE_MS - 1),
      ),
    ).resolves.toEqual([]);
  });

  it("dispatchedのまま回復期限を超えたcheckpointを再回収してappliedにする", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-brain_stale-dispatch");
    const receivedAt = new Date("2026-08-07T00:00:00.000Z");
    const source = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "brain-stale-dispatch",
      body: "今日は公園を散歩した",
      receivedAt,
    });
    await attachMessagesToTurn(db, account.id, [source], 1, "test-model", "test-prompt");
    const [checkpoint] = await db.select().from(schema.diaryBrainCheckpoints);
    const checkpointId = checkpoint?.id ?? "";
    const firstClaimAt = new Date(receivedAt.getTime() + 10 * 60 * 1000);

    await expect(claimDueDiaryBrainCheckpointIds(db, account.id, firstClaimAt)).resolves.toEqual([
      checkpointId,
    ]);
    await expect(
      markDiaryBrainCheckpointDispatched(db, account.id, checkpointId, firstClaimAt),
    ).resolves.toBe(true);

    const recoveryAt = new Date(firstClaimAt.getTime() + DIARY_BRAIN_CHECKPOINT_DISPATCH_LEASE_MS);
    await expect(
      listDueDiaryBrainCheckpointIds(db, account.id, new Date(recoveryAt.getTime() - 1)),
    ).resolves.toEqual([]);
    await expect(listDueDiaryBrainCheckpointIds(db, account.id, recoveryAt)).resolves.toEqual([
      checkpointId,
    ]);
    await expect(claimDueDiaryBrainCheckpointIds(db, account.id, recoveryAt)).resolves.toEqual([
      checkpointId,
    ]);
    await expect(
      markDiaryBrainCheckpointDispatched(db, account.id, checkpointId, recoveryAt),
    ).resolves.toBe(true);

    const context = await getDiaryBrainCheckpointContext(db, account.id, checkpointId);
    await expect(
      applyDiaryBrainCheckpoint(
        db,
        account.id,
        checkpointId,
        context?.throughSequence ?? 0,
        "diary-brain-test",
        [
          {
            category: "memory",
            statement: "今日は公園を散歩した",
            sourceMessageIds: context?.sourceMessageIds ?? [],
          },
        ],
        recoveryAt,
      ),
    ).resolves.toMatchObject({ candidates: [{ operation: "created" }] });
    expect(
      db
        .select({ status: schema.diaryBrainCheckpoints.status })
        .from(schema.diaryBrainCheckpoints)
        .where(eq(schema.diaryBrainCheckpoints.id, checkpointId))
        .get(),
    ).toEqual({ status: "applied" });
  });

  it("回復再投入と元のQueue処理が競合してもcheckpointを二重適用しない", async () => {
    const db = createTestDb();
    const account = await bindAccount(db, "account-brain_recovery-race");
    const receivedAt = new Date("2026-08-07T00:00:00.000Z");
    const source = await storeLineTextSource(db, {
      accountId: account.id,
      eventId: "brain-recovery-race",
      body: "毎朝コーヒーを飲む",
      receivedAt,
    });
    await attachMessagesToTurn(db, account.id, [source], 1, "test-model", "test-prompt");
    const [checkpoint] = await db.select().from(schema.diaryBrainCheckpoints);
    const checkpointId = checkpoint?.id ?? "";
    const firstClaimAt = new Date(receivedAt.getTime() + 10 * 60 * 1000);
    await claimDueDiaryBrainCheckpointIds(db, account.id, firstClaimAt);
    await markDiaryBrainCheckpointDispatched(db, account.id, checkpointId, firstClaimAt);

    // 元のQueue処理がcontextを読んだ後に、Alarmが同じcheckpointを再claimする競合を再現する。
    const originalContext = await getDiaryBrainCheckpointContext(db, account.id, checkpointId);
    const recoveryAt = new Date(firstClaimAt.getTime() + DIARY_BRAIN_CHECKPOINT_DISPATCH_LEASE_MS);
    await expect(claimDueDiaryBrainCheckpointIds(db, account.id, recoveryAt)).resolves.toEqual([
      checkpointId,
    ]);
    const replayContext = await getDiaryBrainCheckpointContext(db, account.id, checkpointId);
    const candidates = [
      {
        category: "behavior_pattern" as const,
        statement: "毎朝コーヒーを飲む",
        sourceMessageIds: originalContext?.sourceMessageIds ?? [],
      },
    ];

    await expect(
      applyDiaryBrainCheckpoint(
        db,
        account.id,
        checkpointId,
        originalContext?.throughSequence ?? 0,
        "diary-brain-test",
        candidates,
        recoveryAt,
      ),
    ).resolves.toMatchObject({ candidates: [{ operation: "created" }] });
    await expect(
      applyDiaryBrainCheckpoint(
        db,
        account.id,
        checkpointId,
        replayContext?.throughSequence ?? 0,
        "diary-brain-test",
        candidates,
        recoveryAt,
      ),
    ).resolves.toBe(false);
    await expect(db.select().from(schema.brainItems)).resolves.toHaveLength(1);
    await expect(db.select().from(schema.brainItemEvidenceEdges)).resolves.toHaveLength(1);
    await expect(db.select().from(schema.diaryBrainCheckpointItems)).resolves.toHaveLength(1);
  });
});
