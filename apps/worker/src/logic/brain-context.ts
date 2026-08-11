import {
  type BrainChatContextMemory,
  type ConversationContextMessage,
  accountDataFor,
} from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { BRAIN_VECTOR_DIMENSIONS } from "../config/schema";
import { createBrainOwnerScope } from "../infrastructure/brain-vector-id";
import { createGeminiClient, embedQuery } from "../infrastructure/gemini-client";

const VECTOR_CANDIDATE_LIMIT = 10;
const SEARCH_QUERY_CHARACTER_LIMIT = 10_000;

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
): string | undefined {
  const currentIds = new Set(currentUserMessageIds);
  const query = messages
    .filter(({ id, role }) => role === "user" && currentIds.has(id))
    .map(({ body }) => body.trim())
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

  try {
    const values = await dependencies.embedSearchQuery(
      dependencies.createGemini({ googleVertexAiApiKey: apiKey }),
      {
        model: input.workerConfig.geminiEmbeddingModel,
        contents: query,
        dimensions: BRAIN_VECTOR_DIMENSIONS,
        ...(input.signal ? { signal: input.signal } : {}),
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
    const vectorIds = result.matches.map(({ id }) => id);
    return accountDataFor(accountDataNamespace, input.accountId).execute(
      "brain.loadChatContextMemories",
      vectorIds,
    );
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
  }
}
