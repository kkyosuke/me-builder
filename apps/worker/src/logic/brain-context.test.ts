import type { AccountDataNamespace, BrainChatContextMemory } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudflareBindings } from "../config";
import { getWorkerConfig } from "../config";
import {
  type BrainContextDependencies,
  buildBrainSearchQuery,
  loadBrainContextMemories,
} from "./brain-context";

const messages = [
  { id: "past-user", role: "user" as const, body: "昨日は仕事をした", sequence: 1 },
  { id: "assistant", role: "assistant" as const, body: "お疲れさま", sequence: 2 },
  { id: "current-1", role: "user" as const, body: "今日は疲れた", sequence: 3 },
  { id: "current-2", role: "user" as const, body: "落ち着く方法を探したい", sequence: 4 },
];

function createHarness(options: { queryError?: Error } = {}) {
  const memories: readonly BrainChatContextMemory[] = [
    {
      brainItemId: "brain-1",
      category: "memory",
      statement: "公園を歩くと落ち着くことがある",
      derivation: "ai",
      status: "active",
      confidence: { state: "uncomputed" },
      accessLabels: ["unclassified"],
      recordedAt: new Date("2026-08-10T00:00:00Z"),
      evidence: [
        {
          sourceRecordId: "source-1",
          text: "公園を散歩したら落ち着いた",
          recordedAt: new Date("2026-08-10T00:00:00Z"),
        },
      ],
    },
  ];
  const execute = vi.fn().mockResolvedValue(memories);
  const accountData = {
    getByName: vi.fn(() => ({ execute })),
  } as unknown as AccountDataNamespace;
  const query = options.queryError
    ? vi.fn().mockRejectedValue(options.queryError)
    : vi.fn().mockResolvedValue({
        matches: [
          { id: "vector-2", score: 0.9 },
          { id: "vector-1", score: 0.8 },
        ],
        count: 2,
      });
  const cf = {
    do: { accountData },
    vector: { brain: { query } },
  } as unknown as CloudflareBindings;
  const dependencies: BrainContextDependencies = {
    createOwnerScope: vi.fn().mockResolvedValue("owner-scope"),
    createGemini: vi.fn(() => ({}) as never),
    embedSearchQuery: vi.fn().mockResolvedValue(Array.from({ length: 768 }, () => 0.1)),
  };
  return { cf, dependencies, execute, query, memories };
}

describe("buildBrainSearchQuery", () => {
  it("現在Turnのuser発言だけを順番どおり検索文にする", () => {
    expect(buildBrainSearchQuery(messages, ["current-1", "current-2"])).toBe(
      "今日は疲れた\n落ち着く方法を探したい",
    );
  });
});

describe("loadBrainContextMemories", () => {
  afterEach(() => vi.useRealTimers());

  it("owner_scopeをtopK前にfilterし、候補IDをAccountDataで再認可する", async () => {
    const harness = createHarness();
    const result = await loadBrainContextMemories(
      {
        cf: harness.cf,
        workerConfig: getWorkerConfig({
          GOOGLE_VERTEX_AI_API_KEY: "google-key",
          BRAIN_VECTOR_HMAC_SECRET: "hmac-secret",
        }),
        accountId: "account-1",
        messages,
        currentUserMessageIds: ["current-1", "current-2"],
      },
      harness.dependencies,
    );

    expect(result).toBe(harness.memories);
    expect(harness.query).toHaveBeenCalledWith(expect.any(Array), {
      topK: 10,
      filter: { owner_scope: { $eq: "owner-scope" } },
      returnValues: false,
      returnMetadata: "none",
    });
    expect(harness.execute).toHaveBeenCalledWith("account-1", "brain.loadChatContextMemories", [
      "vector-2",
      "vector-1",
    ]);
  });

  it("最低score未満の候補をAccountDataへ渡さない", async () => {
    const harness = createHarness();
    harness.query.mockResolvedValue({
      matches: [
        { id: "vector-relevant", score: 0.7 },
        { id: "vector-unrelated", score: 0.699 },
      ],
      count: 2,
    });

    await loadBrainContextMemories(
      {
        cf: harness.cf,
        workerConfig: getWorkerConfig({
          GOOGLE_VERTEX_AI_API_KEY: "google-key",
          BRAIN_VECTOR_HMAC_SECRET: "hmac-secret",
        }),
        accountId: "account-1",
        messages,
        currentUserMessageIds: ["current-1", "current-2"],
      },
      harness.dependencies,
    );

    expect(harness.execute).toHaveBeenCalledWith("account-1", "brain.loadChatContextMemories", [
      "vector-relevant",
    ]);
  });

  it("検索専用timeout後も生成用の親signalをabortしない", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const dependencies = {
      ...harness.dependencies,
      embedSearchQuery: vi.fn(() => new Promise<number[]>(() => undefined)),
    };
    const generationController = new AbortController();
    const search = loadBrainContextMemories(
      {
        cf: harness.cf,
        workerConfig: getWorkerConfig({
          GOOGLE_VERTEX_AI_API_KEY: "google-key",
          BRAIN_VECTOR_HMAC_SECRET: "hmac-secret",
        }),
        accountId: "account-1",
        messages,
        currentUserMessageIds: ["current-1", "current-2"],
        signal: generationController.signal,
      },
      dependencies,
    );

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(search).resolves.toEqual([]);
    expect(generationController.signal.aborted).toBe(false);
  });

  it("検索障害時は本文をlogへ出さず、記憶なしで通常返信を継続する", async () => {
    const harness = createHarness({ queryError: new Error("private query contents") });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await expect(
      loadBrainContextMemories(
        {
          cf: harness.cf,
          workerConfig: getWorkerConfig({
            GOOGLE_VERTEX_AI_API_KEY: "google-key",
            BRAIN_VECTOR_HMAC_SECRET: "hmac-secret",
          }),
          accountId: "account-1",
          messages,
          currentUserMessageIds: ["current-1", "current-2"],
        },
        harness.dependencies,
      ),
    ).resolves.toEqual([]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private query contents");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "BRAIN_CONTEXT_SEARCH_FAILED" }),
      expect.stringContaining("continue without memories"),
    );
  });
});
