import type { AccountDataNamespace, D1 } from "@me-builder/lib";
import { type BrainVectorSyncQueueMessage, type Message, logger } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CloudflareBindings, getWorkerConfig } from "../config";

const geminiMocks = vi.hoisted(() => ({
  createGeminiClient: vi.fn(() => ({})),
  embedDocument: vi.fn(),
}));

vi.mock("../infrastructure/gemini-client", () => geminiMocks);

import { processBrainVectorSyncMessage } from "./brain-vector-sync";

const queueBody: BrainVectorSyncQueueMessage = {
  type: "brain-vector-sync",
  accountId: "account-1",
  jobId: "job-1",
  brainItemId: "brain-1",
  itemRevision: 100,
};

function createMessage() {
  return {
    body: queueBody,
    ack: vi.fn(),
  } as unknown as Message<BrainVectorSyncQueueMessage>;
}

function createBindings(execute: ReturnType<typeof vi.fn>, index: object): CloudflareBindings {
  const accountData = {
    getByName: vi.fn(() => ({ execute })),
  } as unknown as AccountDataNamespace;
  return {
    d1: {} as D1.shared.Client,
    do: { conversation: undefined, accountData },
    queue: { chatTurn: undefined, brainCheckpoint: undefined },
    vector: { brain: index as NonNullable<CloudflareBindings["vector"]>["brain"] },
  };
}

const config = getWorkerConfig({
  ENVIRONMENT: "test",
  GOOGLE_VERTEX_AI_API_KEY: "google-key",
  BRAIN_VECTOR_HMAC_SECRET: "scope-secret",
});

describe("Brain vector sync queue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("active Itemをembeddingし、仮名scopeだけをmetadataへ保存する", async () => {
    geminiMocks.embedDocument.mockResolvedValue(Array.from({ length: 768 }, () => 0.1));
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        action: "upsert",
        embeddingText: "来月までに転職先を決めたい\n時点情報: 来月 = 2026年9月",
        category: "goal",
        derivation: "ai",
        itemRevision: 100,
      })
      .mockResolvedValueOnce(true);
    const upsert = vi.fn(async (vectors) => ({ ids: vectors.map(({ id }: { id: string }) => id) }));
    const message = createMessage();

    await processBrainVectorSyncMessage(message, createBindings(execute, { upsert }), config);

    expect(upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        id: expect.stringMatching(/^[0-9a-f]{64}$/),
        values: expect.any(Array),
        metadata: expect.objectContaining({
          owner_scope: expect.stringMatching(/^[0-9a-f]{64}$/),
          category: "goal",
          derivation: "ai",
          embedding_version: 1,
          schema_version: 1,
        }),
      }),
    ]);
    expect(upsert.mock.calls[0]?.[0]?.[0]?.values).toHaveLength(768);
    expect(geminiMocks.embedDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contents: "来月までに転職先を決めたい\n時点情報: 来月 = 2026年9月",
      }),
    );
    const metadata = upsert.mock.calls[0]?.[0]?.[0]?.metadata;
    expect(JSON.stringify(metadata)).not.toContain("account-1");
    expect(JSON.stringify(metadata)).not.toContain("brain-1");
    expect(JSON.stringify(metadata)).not.toContain("転職先を決めたい");
    expect(execute).toHaveBeenLastCalledWith(
      "account-1",
      "brain.completeVectorSyncJob",
      "job-1",
      {
        action: "upsert",
        vectorId: expect.stringMatching(/^[0-9a-f]{64}$/),
        itemRevision: 100,
      },
      expect.stringMatching(/^accepted:/),
    );
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("処理時に利用不可ならembeddingせず決定的vector IDを削除する", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ action: "delete", vectorId: "stored-vector" })
      .mockResolvedValueOnce(true);
    const deleteByIds = vi.fn(async (ids) => ({ ids }));
    const message = createMessage();

    await processBrainVectorSyncMessage(message, createBindings(execute, { deleteByIds }), config);

    expect(deleteByIds).toHaveBeenCalledWith(["stored-vector"]);
    expect(geminiMocks.embedDocument).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("vector IDが変わったupsertでは旧IDも削除する", async () => {
    geminiMocks.embedDocument.mockResolvedValue(Array.from({ length: 768 }, () => 0.1));
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        action: "upsert",
        embeddingText: "公園を散歩した",
        category: "memory",
        derivation: "ai",
        itemRevision: 100,
        previousVectorId: "old-vector",
      })
      .mockResolvedValueOnce(true);
    const upsert = vi.fn(async (vectors) => ({ ids: vectors.map(({ id }: { id: string }) => id) }));
    const deleteByIds = vi.fn(async (ids) => ({ ids }));

    await processBrainVectorSyncMessage(
      createMessage(),
      createBindings(execute, { upsert, deleteByIds }),
      config,
    );

    expect(deleteByIds).toHaveBeenCalledWith(["old-vector"]);
    expect(execute).toHaveBeenLastCalledWith(
      "account-1",
      "brain.completeVectorSyncJob",
      "job-1",
      expect.objectContaining({ action: "upsert", itemRevision: 100 }),
      expect.stringContaining("accepted:"),
    );
  });

  it("Vectorize失敗を本文なしで記録し、Queueをackしてoutbox再試行へ委ねる", async () => {
    const nextAttemptAt = new Date("2026-08-10T00:01:00Z");
    const execute = vi.fn().mockResolvedValueOnce({ action: "delete" }).mockResolvedValueOnce({
      outcome: "retry-scheduled",
      attemptCount: 1,
      nextAttemptAt,
    });
    const message = createMessage();

    await processBrainVectorSyncMessage(
      message,
      createBindings(execute, {
        deleteByIds: vi.fn(async () => {
          throw new TypeError("provider response contained private payload");
        }),
      }),
      config,
    );
    expect(execute).toHaveBeenLastCalledWith(
      "account-1",
      "brain.failVectorSyncJob",
      "job-1",
      "BRAIN_VECTOR_SYNC_FAILED",
      true,
    );
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("非一時の設定不備を終端化し、構造化error logで検知可能にする", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ action: "delete" })
      .mockResolvedValueOnce({ outcome: "failed", attemptCount: 1 });
    const message = createMessage();
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const configWithoutSecret = getWorkerConfig({
      ENVIRONMENT: "test",
      GOOGLE_VERTEX_AI_API_KEY: "google-key",
    });

    await processBrainVectorSyncMessage(
      message,
      createBindings(execute, { deleteByIds: vi.fn() }),
      configWithoutSecret,
    );

    expect(execute).toHaveBeenLastCalledWith(
      "account-1",
      "brain.failVectorSyncJob",
      "job-1",
      "BRAIN_VECTOR_HMAC_SECRET_NOT_CONFIGURED",
      false,
    );
    expect(message.ack).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "queue.message.failed",
        component: "brain-vector-sync",
        outcome: "failed",
        disposition: "ack",
        jobStatus: "failed",
        retryable: false,
        attempt: 1,
        maxAttempts: 6,
        terminalReason: "non-retryable",
      }),
      expect.stringContaining("BRAIN_VECTOR_HMAC_SECRET_NOT_CONFIGURED"),
    );
  });
});
