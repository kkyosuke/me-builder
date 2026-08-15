import {
  type BrainChatContextMemory,
  type ConversationContextMessage,
  accountDataFor,
  buildDiaryTemporalSearchText,
  resolveDiaryTemporalContext,
} from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { BRAIN_VECTOR_DIMENSIONS } from "../config/schema";
import { createBrainOwnerScope } from "../infrastructure/brain-vector-id";
import { createGeminiClient, embedQuery } from "../infrastructure/gemini-client";

const VECTOR_CANDIDATE_LIMIT = 10;
const SEARCH_QUERY_CHARACTER_LIMIT = 10_000;
const BRAIN_SEARCH_TIMEOUT_MS = 2_000;
const BRAIN_SEARCH_MINIMUM_SCORE = 0.7;

export type BrainContextDependencies = Readonly<{
  createOwnerScope: typeof createBrainOwnerScope;
  createGemini: typeof createGeminiClient;
  embedSearchQuery: typeof embedQuery;
}>;

const defaultDependencies: BrainContextDependencies = {
  createOwnerScope: createBrainOwnerScope,
  createGemini: createGeminiClient,
  embedSearchQuery: embedQuery,
};

/** 連投を含む現在Turnだけを検索queryにし、過去assistant発言を検索意図へ混ぜない。 */
export function buildBrainSearchQuery(
  messages: readonly ConversationContextMessage[],
  currentUserMessageIds: readonly string[],
  at = new Date(),
): string | undefined {
  const currentIds = new Set(currentUserMessageIds);
  const query = messages
    .filter(({ id, role }) => role === "user" && currentIds.has(id))
    .map(({ body, recordedAt }) => {
      const statement = body.trim();
      if (!statement) return "";
      return buildDiaryTemporalSearchText(
        statement,
        resolveDiaryTemporalContext(statement, recordedAt ?? at),
      );
    })
    .filter(Boolean)
    .join("\n");
  if (!query) return undefined;
  return query.slice(-SEARCH_QUERY_CHARACTER_LIMIT);
}

/**
 * Vectorizeは候補抽出だけに使い、最終的な所有・状態・期間・Access Label判定はAccountDataへ戻す。
 * 検索障害で通常返信を止めず、本文を含まない固定ログを残して記憶なしへ縮退する。
 */
export async function loadBrainContextMemories(
  input: Readonly<{
    cf: CloudflareBindings;
    workerConfig: WorkerConfig;
    accountId: string;
    messages: readonly ConversationContextMessage[];
    currentUserMessageIds: readonly string[];
    semanticSearchDays?: number | null;
    signal?: AbortSignal;
  }>,
  dependencies: BrainContextDependencies = defaultDependencies,
): Promise<readonly BrainChatContextMemory[]> {
  const index = input.cf.vector?.brain;
  const accountDataNamespace = input.cf.do.accountData;
  const apiKey = input.workerConfig.googleVertexAiApiKey;
  const hmacSecret = input.workerConfig.brainVectorHmacSecret;
  const query = buildBrainSearchQuery(input.messages, input.currentUserMessageIds);
  if (!index || !accountDataNamespace || !apiKey || !hmacSecret || !query) return [];

  const searchController = new AbortController();
  const forwardParentAbort = () => searchController.abort(input.signal?.reason);
  const timeoutError = new Error("Brain context search timed out");
  timeoutError.name = "TimeoutError";
  const timeout = setTimeout(() => searchController.abort(timeoutError), BRAIN_SEARCH_TIMEOUT_MS);
  const aborted = new Promise<never>((_, reject) => {
    searchController.signal.addEventListener(
      "abort",
      () => reject(searchController.signal.reason ?? timeoutError),
      { once: true },
    );
  });
  if (input.signal?.aborted) forwardParentAbort();
  else input.signal?.addEventListener("abort", forwardParentAbort, { once: true });

  try {
    return await Promise.race([
      aborted,
      (async () => {
        const values = await dependencies.embedSearchQuery(
          dependencies.createGemini({ googleVertexAiApiKey: apiKey }),
          {
            model: input.workerConfig.geminiEmbeddingModel,
            contents: query,
            dimensions: BRAIN_VECTOR_DIMENSIONS,
            signal: searchController.signal,
          },
        );
        if (!values) throw new Error("Brain search embedding response is invalid");
        const ownerScope = await dependencies.createOwnerScope(hmacSecret, input.accountId);
        const result = await index.query(values, {
          topK: VECTOR_CANDIDATE_LIMIT,
          filter: { owner_scope: { $eq: ownerScope } },
          returnValues: false,
          returnMetadata: "none",
        });
        if (searchController.signal.aborted) throw searchController.signal.reason;
        const vectorIds = result.matches
          .filter(({ score }) => Number.isFinite(score) && score >= BRAIN_SEARCH_MINIMUM_SCORE)
          .map(({ id }) => id);
        const at = new Date();
        const notBefore =
          input.semanticSearchDays == null
            ? undefined
            : new Date(at.getTime() - input.semanticSearchDays * 24 * 60 * 60 * 1_000);
        const account = accountDataFor(accountDataNamespace, input.accountId);
        return notBefore
          ? account.execute("brain.loadChatContextMemories", vectorIds, at, notBefore)
          : account.execute("brain.loadChatContextMemories", vectorIds);
      })(),
    ]);
  } catch (error) {
    logger.warn(
      {
        event: "brain.context.search.failed",
        service: "worker",
        component: "chat-turn",
        outcome: "degraded",
        disposition: "continue",
        stage: "context.brain-search",
        errorCode: "BRAIN_CONTEXT_SEARCH_FAILED",
        errorCategory: "dependency",
        retryable: false,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "[Brain context] failed at context.brain-search -> continue without memories",
    );
    return [];
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forwardParentAbort);
  }
}
