import type { AccountDataNamespace, BrainSemanticDedupCandidate } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import type { CloudflareBindings } from "../config";
import { getWorkerConfig } from "../config";
import { type BrainDedupDependencies, decideDiaryBrainDuplicates } from "./brain-dedup";

const workerConfig = getWorkerConfig({
  ENVIRONMENT: "test",
  GOOGLE_VERTEX_AI_API_KEY: "google-key",
  BRAIN_VECTOR_HMAC_SECRET: "scope-secret",
});

function createHarness(existing: readonly BrainSemanticDedupCandidate[]) {
  const execute = vi.fn().mockResolvedValue(existing);
  const accountData = { getByName: vi.fn(() => ({ execute })) } as unknown as AccountDataNamespace;
  const query = vi.fn().mockResolvedValue({
    matches: [{ id: "vector-1", score: 0.71 }],
    count: 1,
  });
  const cf = {
    do: { accountData },
    vector: { brain: { query } },
  } as unknown as CloudflareBindings;
  const dependencies = {
    createGemini: vi.fn(() => ({}) as never),
    embedSearchQuery: vi.fn().mockResolvedValue(Array.from({ length: 768 }, () => 0.1)),
    generateDecision: vi.fn().mockResolvedValue('{"matches":[]}'),
    createOwnerScope: vi.fn().mockResolvedValue("owner-scope"),
  } satisfies BrainDedupDependencies;
  return { cf, dependencies, execute, query };
}

const candidate = {
  category: "preference",
  statement: "辛いものはあまり食べられない",
  sourceMessageIds: ["message-1"],
};
const existing = {
  brainItemId: "brain-1",
  category: "preference",
  statement: "辛い食べ物が苦手",
  comparisonText: "辛い食べ物が苦手",
  isInference: false,
};

describe("decideDiaryBrainDuplicates", () => {
  it("Vector候補を専用AIが同一命題と判定した場合だけsemantic matchを返す", async () => {
    const harness = createHarness([existing]);
    harness.dependencies.generateDecision = vi.fn().mockResolvedValue(
      JSON.stringify({
        matches: [
          {
            candidate_index: 0,
            existing_brain_item_id: "brain-1",
            judgment: "same_proposition",
          },
        ],
      }),
    );

    await expect(
      decideDiaryBrainDuplicates(
        {
          candidates: [candidate],
          messages: [
            {
              id: "message-1",
              role: "user",
              body: candidate.statement,
              sequence: 1,
              recordedAt: new Date("2026-08-11T03:00:00Z"),
            },
          ],
          accountId: "account-1",
          cf: harness.cf,
          workerConfig,
        },
        harness.dependencies,
      ),
    ).resolves.toEqual([
      {
        matchingBrainItemId: "brain-1",
        deduplication: "semantic",
        dedupPromptVersion: "brain-dedup-v1",
      },
    ]);
    expect(harness.query).toHaveBeenCalledWith(expect.any(Array), {
      topK: 10,
      filter: { owner_scope: { $eq: "owner-scope" } },
      returnValues: false,
      returnMetadata: "none",
    });
    expect(harness.execute).toHaveBeenCalledWith(
      "account-1",
      "brain.loadSemanticDedupCandidates",
      ["vector-1"],
      ["preference"],
    );
  });

  it("原文と解決済み時点情報が一致すればAIを呼ばずexact matchにする", async () => {
    const temporalCandidate = {
      category: "goal",
      statement: "来月までに転職先を決めたい",
      sourceMessageIds: ["message-1"],
    };
    const harness = createHarness([
      {
        brainItemId: "brain-goal",
        category: "goal",
        statement: temporalCandidate.statement,
        comparisonText: "来月までに転職先を決めたい\n時点情報: 来月 = 2026年9月",
        isInference: false,
      },
    ]);

    await expect(
      decideDiaryBrainDuplicates(
        {
          candidates: [temporalCandidate],
          messages: [
            {
              id: "message-1",
              role: "user",
              body: temporalCandidate.statement,
              sequence: 1,
              recordedAt: new Date("2026-08-11T03:00:00Z"),
            },
          ],
          accountId: "account-1",
          cf: harness.cf,
          workerConfig,
        },
        harness.dependencies,
      ),
    ).resolves.toEqual([{ matchingBrainItemId: "brain-goal", deduplication: "exact" }]);
    expect(harness.dependencies.generateDecision).not.toHaveBeenCalled();
  });

  it("検索候補外のIDをAIが返した場合は保存せず再試行へ倒す", async () => {
    const harness = createHarness([existing]);
    harness.dependencies.generateDecision = vi.fn().mockResolvedValue(
      JSON.stringify({
        matches: [
          {
            candidate_index: 0,
            existing_brain_item_id: "outside-item",
            judgment: "same_proposition",
          },
        ],
      }),
    );

    await expect(
      decideDiaryBrainDuplicates(
        {
          candidates: [candidate],
          messages: [],
          accountId: "account-1",
          cf: harness.cf,
          workerConfig,
        },
        harness.dependencies,
      ),
    ).resolves.toBeUndefined();
  });
});
