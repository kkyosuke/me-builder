import {
  type ConversationContextMessage,
  type DiaryBrainCategory,
  accountDataFor,
  buildDiaryTemporalSearchText,
  resolveDiaryTemporalContext,
} from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { BRAIN_VECTOR_DIMENSIONS } from "../config/schema";
import { createBrainOwnerScope } from "../infrastructure/brain-vector-id";
import {
  type GeminiUsageRecorder,
  createGeminiClient,
  embedQuery,
  generateStructuredText,
} from "../infrastructure/gemini-client";
import { BRAIN_DEDUP_PROMPT_VERSION, BRAIN_DEDUP_SYSTEM_PROMPT } from "../prompt/brain-dedup";

const VECTOR_CANDIDATE_LIMIT_PER_ITEM = 10;

const MatchSchema = v.strictObject({
  candidate_index: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2)),
  existing_brain_item_id: v.exactOptional(v.pipe(v.string(), v.minLength(1))),
  canonical_candidate_index: v.exactOptional(
    v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2)),
  ),
  judgment: v.literal("same_proposition"),
});
const ResponseSchema = v.strictObject({
  matches: v.pipe(v.array(MatchSchema), v.maxLength(3)),
});

export type DiaryBrainDedupCandidate = Readonly<{
  category: DiaryBrainCategory;
  statement: string;
  sourceMessageIds: readonly string[];
}>;

export type DiaryBrainDedupDecision = Readonly<{
  matchingBrainItemId?: string;
  matchingCandidateIndex?: number;
  deduplication: "none" | "exact" | "semantic";
  dedupPromptVersion?: string;
}>;

export type ConsolidatedDiaryBrainCandidate = DiaryBrainDedupCandidate &
  Readonly<{
    matchingBrainItemId?: string;
    deduplication: "none" | "exact" | "semantic";
    dedupPromptVersion?: string;
  }>;

export type BrainDedupDependencies = Readonly<{
  createGemini: typeof createGeminiClient;
  embedSearchQuery: typeof embedQuery;
  generateDecision: typeof generateStructuredText;
  createOwnerScope: typeof createBrainOwnerScope;
}>;

const defaultDependencies: BrainDedupDependencies = {
  createGemini: createGeminiClient,
  embedSearchQuery: embedQuery,
  generateDecision: generateStructuredText,
  createOwnerScope: createBrainOwnerScope,
};

function comparisonText(
  candidate: DiaryBrainDedupCandidate,
  messages: readonly ConversationContextMessage[],
): string {
  const sourceIds = new Set(candidate.sourceMessageIds);
  const timestamps = messages.flatMap(({ id, recordedAt }) =>
    sourceIds.has(id) && recordedAt ? [recordedAt.getTime()] : [],
  );
  if (timestamps.length === 0) return candidate.statement;
  const recordedAt = new Date(Math.min(...timestamps));
  return buildDiaryTemporalSearchText(
    candidate.statement,
    resolveDiaryTemporalContext(candidate.statement, recordedAt),
  );
}

function exactKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/** 同じcheckpoint内で同一命題と判定した候補のEvidenceを代表候補へ集約する。 */
export function consolidateDiaryBrainCandidates(
  candidates: readonly DiaryBrainDedupCandidate[],
  decisions: readonly DiaryBrainDedupDecision[],
): readonly ConsolidatedDiaryBrainCandidate[] {
  if (candidates.length !== decisions.length) {
    throw new Error("Diary Brain deduplication result length does not match candidates");
  }
  const rootIndex = (candidateIndex: number): number => {
    let current = candidateIndex;
    while (decisions[current]?.matchingCandidateIndex !== undefined) {
      const parent = decisions[current]?.matchingCandidateIndex;
      if (parent === undefined || parent < 0 || parent >= current) {
        throw new Error("Diary Brain candidate deduplication target is invalid");
      }
      current = parent;
    }
    return current;
  };
  const consolidated = new Map<number, ConsolidatedDiaryBrainCandidate>();
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const root = rootIndex(candidateIndex);
    const rootCandidate = candidates[root];
    const rootDecision = decisions[root];
    if (!rootCandidate || !rootDecision) {
      throw new Error("Diary Brain candidate deduplication root is missing");
    }
    const existing = consolidated.get(root);
    const sourceMessageIds = [
      ...new Set([...(existing?.sourceMessageIds ?? []), ...candidate.sourceMessageIds]),
    ];
    consolidated.set(root, {
      ...rootCandidate,
      sourceMessageIds,
      ...(rootDecision.matchingBrainItemId
        ? { matchingBrainItemId: rootDecision.matchingBrainItemId }
        : {}),
      deduplication: rootDecision.matchingBrainItemId ? rootDecision.deduplication : "none",
      ...(rootDecision.matchingBrainItemId && rootDecision.dedupPromptVersion
        ? { dedupPromptVersion: rootDecision.dedupPromptVersion }
        : {}),
    });
  }
  return [...consolidated.values()];
}

/** Vectorは比較対象の絞り込みにだけ使い、同一命題の最終判断は専用AIへ分離する。 */
export async function decideDiaryBrainDuplicates(
  input: Readonly<{
    candidates: readonly DiaryBrainDedupCandidate[];
    messages: readonly ConversationContextMessage[];
    accountId: string;
    cf: CloudflareBindings;
    workerConfig: WorkerConfig;
    onUsage?: GeminiUsageRecorder;
  }>,
  dependencies: BrainDedupDependencies = defaultDependencies,
): Promise<readonly DiaryBrainDedupDecision[] | undefined> {
  if (input.candidates.length === 0) return [];
  const accountDataNamespace = input.cf.do.accountData;
  if (!accountDataNamespace) return undefined;
  const comparisons = input.candidates.map((candidate) =>
    comparisonText(candidate, input.messages),
  );
  const vectorIds: string[] = [];
  const index = input.cf.vector?.brain;
  const apiKey = input.workerConfig.googleVertexAiApiKey;
  const hmacSecret = input.workerConfig.brainVectorHmacSecret;
  if (apiKey && (!index || !hmacSecret)) return undefined;
  if (index && apiKey && hmacSecret) {
    const client = dependencies.createGemini({ googleVertexAiApiKey: apiKey });
    const ownerScope = await dependencies.createOwnerScope(hmacSecret, input.accountId);
    const matches = await Promise.all(
      comparisons.map(async (contents) => {
        const values = await dependencies.embedSearchQuery(client, {
          model: input.workerConfig.geminiEmbeddingModel,
          contents,
          dimensions: BRAIN_VECTOR_DIMENSIONS,
        });
        if (!values) throw new Error("Gemini deduplication embedding response is invalid");
        return index.query(values, {
          topK: VECTOR_CANDIDATE_LIMIT_PER_ITEM,
          filter: { owner_scope: { $eq: ownerScope } },
          returnValues: false,
          returnMetadata: "none",
        });
      }),
    );
    for (const match of matches.flatMap(({ matches }) => matches)) {
      if (match.id && !vectorIds.includes(match.id)) vectorIds.push(match.id);
    }
  }

  const accountData = accountDataFor(accountDataNamespace, input.accountId);
  const existing = await accountData.execute(
    "brain.loadSemanticDedupCandidates",
    vectorIds,
    input.candidates.map(({ category }) => category),
  );
  const eligible = existing.filter(({ isInference }) => !isInference);
  const decisions: DiaryBrainDedupDecision[] = input.candidates.map(() => ({
    deduplication: "none",
  }));
  const unresolvedIndices: number[] = [];
  for (const [index, candidate] of input.candidates.entries()) {
    const exact = eligible.find(
      (item) =>
        item.category === candidate.category &&
        exactKey(item.comparisonText) === exactKey(comparisons[index] ?? candidate.statement),
    );
    if (exact) {
      decisions[index] = {
        matchingBrainItemId: exact.brainItemId,
        deduplication: "exact",
      };
      continue;
    }
    const exactCandidateIndex = comparisons.findIndex(
      (comparison, candidateIndex) =>
        candidateIndex < index &&
        input.candidates[candidateIndex]?.category === candidate.category &&
        exactKey(comparison) === exactKey(comparisons[index] ?? candidate.statement),
    );
    if (exactCandidateIndex >= 0) {
      decisions[index] = {
        matchingCandidateIndex: exactCandidateIndex,
        deduplication: "exact",
      };
    } else if (
      eligible.some((item) => item.category === candidate.category) ||
      input.candidates.some(
        (other, candidateIndex) => candidateIndex < index && other.category === candidate.category,
      )
    ) {
      unresolvedIndices.push(index);
    }
  }
  if (unresolvedIndices.length === 0) return decisions;
  if (!apiKey) return decisions;

  const client = dependencies.createGemini({ googleVertexAiApiKey: apiKey });
  const raw = await dependencies.generateDecision(client, {
    model: input.workerConfig.geminiModel,
    contents: JSON.stringify({
      context_package: {
        new_candidates: unresolvedIndices.map((candidateIndex) => ({
          candidate_index: candidateIndex,
          category: input.candidates[candidateIndex]?.category,
          statement: comparisons[candidateIndex],
          is_inference: false,
        })),
        candidate_targets: input.candidates.map((candidate, candidateIndex) => ({
          candidate_index: candidateIndex,
          category: candidate.category,
          statement: comparisons[candidateIndex],
          is_inference: false,
        })),
        existing_items: eligible.map((item) => ({
          brain_item_id: item.brainItemId,
          category: item.category,
          statement: item.comparisonText,
          is_inference: item.isInference,
        })),
      },
    }),
    systemInstruction: BRAIN_DEDUP_SYSTEM_PROMPT,
    responseJsonSchema: toJsonSchema(ResponseSchema) as Record<string, unknown>,
    maxOutputTokens: 500,
    ...(input.onUsage ? { onUsage: input.onUsage } : {}),
  });
  if (!raw) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = v.safeParse(ResponseSchema, json);
  if (!parsed.success) return undefined;
  const allowedIndices = new Set(unresolvedIndices);
  const existingById = new Map(eligible.map((item) => [item.brainItemId, item] as const));
  const matchedIndices = new Set<number>();
  for (const match of parsed.output.matches) {
    const candidate = input.candidates[match.candidate_index];
    const hasExistingTarget = match.existing_brain_item_id !== undefined;
    const hasCandidateTarget = match.canonical_candidate_index !== undefined;
    const item = match.existing_brain_item_id
      ? existingById.get(match.existing_brain_item_id)
      : undefined;
    const canonicalCandidate =
      match.canonical_candidate_index === undefined
        ? undefined
        : input.candidates[match.canonical_candidate_index];
    if (
      !candidate ||
      !allowedIndices.has(match.candidate_index) ||
      matchedIndices.has(match.candidate_index) ||
      hasExistingTarget === hasCandidateTarget ||
      (hasExistingTarget && (!item || item.category !== candidate.category)) ||
      (hasCandidateTarget &&
        (!canonicalCandidate ||
          (match.canonical_candidate_index ?? match.candidate_index) >= match.candidate_index ||
          canonicalCandidate.category !== candidate.category))
    ) {
      logger.error(
        { candidateIndex: match.candidate_index, validationReason: "invalid_dedup_match" },
        "Rejected invalid Brain deduplication decision",
      );
      return undefined;
    }
    matchedIndices.add(match.candidate_index);
    if (item) {
      decisions[match.candidate_index] = {
        matchingBrainItemId: item.brainItemId,
        deduplication: "semantic",
        dedupPromptVersion: BRAIN_DEDUP_PROMPT_VERSION,
      };
    } else {
      const canonicalCandidateIndex = match.canonical_candidate_index;
      if (canonicalCandidateIndex === undefined) return undefined;
      decisions[match.candidate_index] = {
        matchingCandidateIndex: canonicalCandidateIndex,
        deduplication: "semantic",
        dedupPromptVersion: BRAIN_DEDUP_PROMPT_VERSION,
      };
    }
  }
  return decisions;
}
