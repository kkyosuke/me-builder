import path from "node:path";
import { DO } from "@me-builder/lib";
import type { AccountDataNamespace } from "@me-builder/lib";
import type { DiaryBrainCheckpointQueueMessage, Message } from "@me-builder/shared";
import { logger } from "@me-builder/shared";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { processDiaryBrainCheckpointMessage } from "./diary-brain-checkpoint";

const { decideDiaryBrainDuplicates, generateDiaryBrainCandidates } = vi.hoisted(() => ({
  decideDiaryBrainDuplicates: vi.fn(),
  generateDiaryBrainCandidates: vi.fn(),
}));

vi.mock("../logic/brain-dedup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../logic/brain-dedup")>()),
  decideDiaryBrainDuplicates,
}));
vi.mock("../logic/diary-brain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../logic/diary-brain")>()),
  generateDiaryBrainCandidates,
}));

function createTestDb(): DO.account.Database {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema: DO.account.schema });
  // biome-ignore lint/suspicious/noExplicitAny: D1用migrationをSQLite integration testへ適用する
  migrate(db as any, {
    migrationsFolder: path.resolve(__dirname, "../../../../packages/lib/drizzle-do-account"),
  });
  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      const results = [];
      for (const query of queries) results.push(await query);
      return results;
    },
  });
  return db as unknown as DO.account.Database;
}

describe("processDiaryBrainCheckpointMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
  });

  it("意味的に同じ候補を統合し、各原文を再検証してBrain Itemを保存する", async () => {
    const db = createTestDb();
    const accountId = "account-handler-dedup";
    await db.insert(DO.account.schema.accountDataIdentity).values({ singleton: 1, accountId });
    const receivedAt = new Date("2026-08-12T00:00:00.000Z");
    const first = await DO.account.action.diary.storeLineTextSource(db, {
      accountId,
      eventId: "event-1",
      body: "辛いものは　あまり食べられない",
      receivedAt,
    });
    const second = await DO.account.action.diary.storeLineTextSource(db, {
      accountId,
      eventId: "event-2",
      body: "辛い食べ物が苦手",
      receivedAt: new Date(receivedAt.getTime() + 1_000),
    });
    const third = await DO.account.action.diary.storeLineTextSource(db, {
      accountId,
      eventId: "event-3",
      body: "看護師なの",
      receivedAt: new Date(receivedAt.getTime() + 2_000),
    });
    await DO.account.action.diary.attachMessagesToTurn(
      db,
      accountId,
      [first, second, third],
      1,
      "test-model",
      "test-prompt",
    );
    const [checkpoint] = await db.select().from(DO.account.schema.diaryBrainCheckpoints);
    const checkpointId = checkpoint?.id ?? "";
    await DO.account.action.diary.claimDueDiaryBrainCheckpointIds(
      db,
      accountId,
      new Date(receivedAt.getTime() + 11 * 60 * 1_000),
    );
    await DO.account.action.diary.markDiaryBrainCheckpointDispatched(db, accountId, checkpointId);
    const context = await DO.account.action.diary.getDiaryBrainCheckpointContext(
      db,
      accountId,
      checkpointId,
    );
    const [firstMessageId, secondMessageId, thirdMessageId] = context?.sourceMessageIds ?? [];
    generateDiaryBrainCandidates.mockResolvedValue([
      {
        category: "preference",
        statement: "辛いものは あまり食べられない",
        source_message_ids: [firstMessageId],
        is_inference: false,
      },
      {
        category: "preference",
        statement: "辛い食べ物が苦手",
        source_message_ids: [secondMessageId],
        is_inference: false,
      },
      {
        category: "identity",
        statement: "看護師なの",
        source_message_ids: [thirdMessageId],
        is_inference: false,
        prompt_context: { kind: "occupation", occupation: "看護師" },
      },
    ]);
    decideDiaryBrainDuplicates.mockResolvedValue([
      { deduplication: "none" },
      {
        matchingCandidateIndex: 0,
        deduplication: "semantic",
        dedupPromptVersion: "brain-dedup-v2",
      },
      { deduplication: "none" },
    ]);

    const execute = vi.fn(async (_accountId: string, operation: string, ...args: unknown[]) => {
      if (operation === "conversation.getDiaryBrainCheckpointContext") {
        return DO.account.action.diary.getDiaryBrainCheckpointContext(
          db,
          accountId,
          args[0] as string,
        );
      }
      if (operation === "conversation.applyDiaryBrainCheckpoint") {
        return DO.account.action.diary.applyDiaryBrainCheckpoint(
          db,
          accountId,
          args[0] as string,
          args[1] as number,
          args[2] as string,
          args[3] as Parameters<typeof DO.account.action.diary.applyDiaryBrainCheckpoint>[5],
        );
      }
      throw new Error(`Unexpected AccountData operation: ${operation}`);
    });
    const accountData = {
      getByName: vi.fn(() => ({ execute })),
    } as unknown as AccountDataNamespace;
    const cf = {
      d1: {},
      do: { conversation: undefined, accountData },
      queue: { chatTurn: undefined, brainCheckpoint: undefined },
    } as unknown as CloudflareBindings;
    const workerConfig = {
      environment: "test",
      geminiModel: "gemini-test",
      geminiEmbeddingModel: "gemini-embedding-test",
    } as WorkerConfig;
    const message = {
      id: "queue-message-1",
      timestamp: receivedAt,
      attempts: 1,
      body: { type: "diary-brain-checkpoint", accountId, checkpointId },
      ack: vi.fn(),
      retry: vi.fn(),
    } as Message<DiaryBrainCheckpointQueueMessage>;

    await processDiaryBrainCheckpointMessage(message, cf, workerConfig);

    expect(decideDiaryBrainDuplicates).toHaveBeenCalledOnce();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    await expect(db.select().from(DO.account.schema.brainItems)).resolves.toEqual([
      expect.objectContaining({
        category: "preference",
        statement: "辛いものは あまり食べられない",
      }),
      expect.objectContaining({
        category: "identity",
        statement: "看護師なの",
        attributes: expect.objectContaining({
          promptContext: { kind: "occupation", occupation: "看護師" },
          promptContextPromptVersion: "diary-brain-v5",
        }),
      }),
    ]);
    await expect(db.select().from(DO.account.schema.brainItemEvidenceEdges)).resolves.toHaveLength(
      3,
    );
    await expect(db.select().from(DO.account.schema.diaryBrainCheckpointItems)).resolves.toEqual([
      expect.objectContaining({
        operation: "created",
        deduplication: "semantic",
        dedupPromptVersion: "brain-dedup-v2",
      }),
      expect.objectContaining({ operation: "created", deduplication: "none" }),
    ]);
  });
});
