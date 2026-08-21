import type { VectorizeIndex } from "@cloudflare/workers-types";
import { GoogleGenAI } from "@google/genai";
import { type AccountDataNamespace, D1, accountDataFor } from "@me-builder/lib";
import { hmacSha256Hex } from "@me-builder/shared";

const DIMENSIONS = 768;
const MINIMUM_SCORE = 0.7;

export type McpSearchBindings = Readonly<{
  DB: import("@cloudflare/workers-types").D1Database;
  ACCOUNT_DATA: AccountDataNamespace;
  BRAIN_VECTOR_INDEX: VectorizeIndex;
  GOOGLE_VERTEX_AI_API_KEY: string;
  BRAIN_VECTOR_HMAC_SECRET: string;
  GEMINI_EMBEDDING_MODEL?: string;
  MCP_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}>;

export type McpSearchIdentity = Readonly<{
  accountId: string;
  connectionId: string;
  clientId: string;
  clientName: string;
}>;

async function embedQuery(env: McpSearchBindings, query: string, signal: AbortSignal) {
  const client = new GoogleGenAI({
    vertexai: true,
    apiKey: env.GOOGLE_VERTEX_AI_API_KEY,
    apiVersion: "v1",
  });
  const response = await client.models.embedContent({
    model: env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-001",
    contents: query,
    config: {
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: DIMENSIONS,
      abortSignal: signal,
    },
  });
  const values = response.embeddings?.[0]?.values;
  if (!values || values.length !== DIMENSIONS) throw new Error("MCP embedding unavailable");
  return values;
}

export async function searchMyBrain(
  env: McpSearchBindings,
  identity: McpSearchIdentity,
  query: string,
  signal: AbortSignal,
) {
  const db = D1.shared.client.create(env.DB);
  if (env.MCP_RATE_LIMITER) {
    const allowed = await env.MCP_RATE_LIMITER.limit({ key: identity.connectionId });
    if (!allowed.success) {
      await D1.shared.action.mcp.recordAudit(db, {
        ...identity,
        accountId: identity.accountId,
        outcome: "refused",
        reasonCode: "RATE_LIMITED",
      });
      throw new Error("MCP request rate limited");
    }
  }
  try {
    const [values, ownerScope] = await Promise.all([
      embedQuery(env, query, signal),
      hmacSha256Hex(env.BRAIN_VECTOR_HMAC_SECRET, "brain-owner-scope", identity.accountId),
    ]);
    const matches = await env.BRAIN_VECTOR_INDEX.query(values, {
      topK: 20,
      filter: { mcp_owner_scope: { $eq: ownerScope } },
      returnValues: false,
      returnMetadata: "none",
    });
    const vectorIds = matches.matches
      .filter(({ score }) => Number.isFinite(score) && score >= MINIMUM_SCORE)
      .map(({ id }) => id);
    const results = await accountDataFor(env.ACCOUNT_DATA, identity.accountId).execute(
      "brain.loadMcpSearchResults",
      vectorIds,
    );
    await D1.shared.action.mcp.recordAudit(db, {
      ...identity,
      accountId: identity.accountId,
      outcome: "success",
      reasonCode: "SEARCH_COMPLETED",
      brainItemIds: results.map(({ brainItemId }) => brainItemId),
    });
    return results.map(({ brainItemId, evidence, ...result }) => ({
      id: brainItemId,
      ...result,
      evidence: {
        ...evidence,
        firstObservedAt: evidence.firstObservedAt.toISOString(),
        lastObservedAt: evidence.lastObservedAt.toISOString(),
      },
    }));
  } catch (error) {
    try {
      await D1.shared.action.mcp.recordAudit(db, {
        ...identity,
        accountId: identity.accountId,
        outcome: "failure",
        reasonCode: signal.aborted ? "TIMEOUT_OR_CANCELLED" : "SEARCH_FAILED",
      });
    } catch {
      throw new Error("MCP audit persistence failed");
    }
    throw error;
  }
}
