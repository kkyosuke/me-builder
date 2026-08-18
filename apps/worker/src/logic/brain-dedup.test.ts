import type { AccountDataNamespace, BrainSemanticDedupCandidate } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import type { CloudflareBindings } from "../config";
import { getWorkerConfig } from "../config";
import { brainDedupEvaluationFixtures } from "../evaluation/brain-dedup-fixtures";
import {
  type BrainDedupDependencies,
  type DiaryBrainDedupCandidate,
  consolidateDiaryBrainCandidates,
  decideDiaryBrainDuplicates,
} from "./brain-dedup";

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
  category: "preference" as const,
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
  it.each(brainDedupEvaluationFixtures)(
    "評価fixture $idのモデル判定をproduction parserへ適用する",
    async ({
      category,
      candidate: candidateStatement,
      existing: existingStatement,
      sameProposition,
    }) => {
      const harness = createHarness([
        {
          brainItemId: "existing-fixture",
          category,
          statement: existingStatement,
          comparisonText: existingStatement,
          isInference: false,
        },
      ]);
      harness.dependencies.generateDecision = vi.fn().mockResolvedValue(
        JSON.stringify({
          matches: sameProposition
            ? [
                {
                  candidate_index: 0,
                  existing_brain_item_id: "existing-fixture",
                  judgment: "same_proposition",
                },
              ]
            : [],
        }),
      );

      const decisions = await decideDiaryBrainDuplicates(
        {
          candidates: [
            { category, statement: candidateStatement, sourceMessageIds: ["fixture-message"] },
          ],
          messages: [
            {
              id: "fixture-message",
              role: "user",
              body: candidateStatement,
              sequence: 1,
            },
          ],
          accountId: "account-1",
          cf: harness.cf,
          workerConfig,
        },
        harness.dependencies,
      );

      expect(decisions?.[0]).toEqual(
        sameProposition
          ? {
              matchingBrainItemId: "existing-fixture",
              deduplication: "semantic",
              dedupPromptVersion: "brain-dedup-v3",
            }
          : { deduplication: "none" },
      );
    },
  );

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
        dedupPromptVersion: "brain-dedup-v3",
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
      category: "goal" as const,
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

  it("同じcheckpoint内の意味的に同じ候補を代表候補へまとめる", async () => {
    const candidates: DiaryBrainDedupCandidate[] = [
      candidate,
      {
        category: "preference" as const,
        statement: "辛い食べ物が苦手",
        sourceMessageIds: ["message-2"],
      },
    ];
    const harness = createHarness([]);
    harness.dependencies.generateDecision = vi.fn().mockResolvedValue(
      JSON.stringify({
        matches: [
          {
            candidate_index: 1,
            canonical_candidate_index: 0,
            judgment: "same_proposition",
          },
        ],
      }),
    );

    const decisions = await decideDiaryBrainDuplicates(
      {
        candidates,
        messages: [],
        accountId: "account-1",
        cf: harness.cf,
        workerConfig,
      },
      harness.dependencies,
    );

    expect(decisions).toEqual([
      { deduplication: "none" },
      {
        matchingCandidateIndex: 0,
        deduplication: "semantic",
        dedupPromptVersion: "brain-dedup-v3",
      },
    ]);
    expect(consolidateDiaryBrainCandidates(candidates, decisions ?? [])).toEqual([
      {
        ...candidate,
        sourceMessageIds: ["message-1", "message-2"],
        evidenceStatements: [
          {
            sourceMessageId: "message-1",
            statement: "辛いものはあまり食べられない",
          },
          { sourceMessageId: "message-2", statement: "辛い食べ物が苦手" },
        ],
        deduplication: "semantic",
        dedupPromptVersion: "brain-dedup-v3",
      },
    ]);
    expect(harness.dependencies.generateDecision).toHaveBeenCalledOnce();
  });

  it("統合される候補だけが持つ声かけ属性を代表候補へ引き継ぐ", () => {
    const candidates = [
      {
        category: "behavior_pattern" as const,
        statement: "休みはシフト制",
        sourceMessageIds: ["message-1"],
      },
      {
        category: "behavior_pattern" as const,
        statement: "休みはシフトで変わる",
        sourceMessageIds: ["message-2"],
        promptContext: { kind: "weekly_rhythm" as const, scheduleMode: "variable_shift" as const },
      },
    ];

    expect(
      consolidateDiaryBrainCandidates(candidates, [
        { deduplication: "none" },
        {
          matchingCandidateIndex: 0,
          deduplication: "semantic",
          dedupPromptVersion: "brain-dedup-v2",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        statement: "休みはシフト制",
        promptContext: { kind: "weekly_rhythm", scheduleMode: "variable_shift" },
      }),
    ]);
  });

  it("同一命題へ競合する声かけ属性を統合しない", () => {
    const candidates: DiaryBrainDedupCandidate[] = [
      {
        category: "behavior_pattern" as const,
        statement: "平日は働いて土日は休み",
        sourceMessageIds: ["message-1"],
        promptContext: {
          kind: "weekly_rhythm" as const,
          scheduleMode: "fixed_weekly" as const,
          activeWeekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          daysOff: ["saturday", "sunday"],
        },
      },
      {
        category: "behavior_pattern" as const,
        statement: "休みはシフトで変わる",
        sourceMessageIds: ["message-2"],
        promptContext: { kind: "weekly_rhythm" as const, scheduleMode: "variable_shift" as const },
      },
    ];

    expect(
      consolidateDiaryBrainCandidates(candidates, [
        { deduplication: "none" },
        {
          matchingCandidateIndex: 0,
          deduplication: "semantic",
          dedupPromptVersion: "brain-dedup-v2",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        statement: "平日は働いて土日は休み",
        promptContext: expect.objectContaining({ scheduleMode: "fixed_weekly" }),
        deduplication: "none",
      }),
      expect.objectContaining({
        statement: "休みはシフトで変わる",
        promptContext: { kind: "weekly_rhythm", scheduleMode: "variable_shift" },
        deduplication: "none",
      }),
    ]);
  });

  it("NFKCと空白だけが異なる候補をexact統合して各Evidenceのstatementを保持する", async () => {
    const candidates = [
      {
        category: "preference" as const,
        statement: "A Bが好き",
        sourceMessageIds: ["message-1"],
      },
      {
        category: "preference" as const,
        statement: "Ａ　Ｂが好き",
        sourceMessageIds: ["message-2"],
      },
    ];
    const harness = createHarness([]);

    const decisions = await decideDiaryBrainDuplicates(
      {
        candidates,
        messages: [],
        accountId: "account-1",
        cf: harness.cf,
        workerConfig,
      },
      harness.dependencies,
    );

    expect(decisions).toEqual([
      { deduplication: "none" },
      { matchingCandidateIndex: 0, deduplication: "exact" },
    ]);
    expect(consolidateDiaryBrainCandidates(candidates, decisions ?? [])).toEqual([
      {
        ...candidates[0],
        sourceMessageIds: ["message-1", "message-2"],
        evidenceStatements: [
          { sourceMessageId: "message-1", statement: "A Bが好き" },
          { sourceMessageId: "message-2", statement: "Ａ　Ｂが好き" },
        ],
        deduplication: "exact",
      },
    ]);
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
