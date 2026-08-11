import { accountDataFor } from "@me-builder/lib";
import type { BrainVectorSyncQueueMessage, Message } from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { BRAIN_VECTOR_DIMENSIONS } from "../config/schema";
import { createBrainOwnerScope, createBrainVectorId } from "../infrastructure/brain-vector-id";
import { createGeminiClient, embedDocument } from "../infrastructure/gemini-client";

const EMBEDDING_VERSION = 1;
const METADATA_SCHEMA_VERSION = 1;

export async function processBrainVectorSyncMessage(
  message: Message<BrainVectorSyncQueueMessage>,
  cf: CloudflareBindings,
  workerConfig: WorkerConfig,
): Promise<void> {
  if (!cf.do.accountData) throw new Error("ACCOUNT_DATA binding is not configured");
  const accountData = accountDataFor(cf.do.accountData, message.body.accountId);
  const target = await accountData.execute(
    "brain.getVectorSyncTarget",
    message.body.jobId,
    message.body.brainItemId,
    message.body.itemRevision,
  );
  if (!target) {
    message.ack();
    return;
  }

  try {
    const index = cf.vector?.brain;
    const secret = workerConfig.brainVectorHmacSecret;
    if (!index) throw new Error("BRAIN_VECTOR_INDEX binding is not configured");
    if (!secret) throw new Error("BRAIN_VECTOR_HMAC_SECRET is not configured");
    const vectorId =
      target.action === "delete" && target.vectorId
        ? target.vectorId
        : await createBrainVectorId(secret, message.body.accountId, message.body.brainItemId);
    const mutationIds: string[] = [];
    if (target.action === "delete") {
      mutationIds.push(mutationIdOf(await index.deleteByIds([vectorId])));
    } else {
      mutationIds.push(
        mutationIdOf(
          await upsertBrainVector(
            index,
            vectorId,
            message.body.accountId,
            secret,
            target,
            workerConfig,
          ),
        ),
      );
      if (target.previousVectorId && target.previousVectorId !== vectorId) {
        mutationIds.push(mutationIdOf(await index.deleteByIds([target.previousVectorId])));
      }
    }
    const completed = await accountData.execute(
      "brain.completeVectorSyncJob",
      message.body.jobId,
      target.action === "upsert"
        ? { action: "upsert", vectorId, itemRevision: target.itemRevision }
        : { action: "delete", vectorId },
      mutationIds.join(","),
    );
    if (!completed) throw new Error("Brain vector sync completion could not be recorded");
    message.ack();
  } catch (error) {
    await accountData.execute(
      "brain.failVectorSyncJob",
      message.body.jobId,
      error instanceof Error ? error.name : "UnknownError",
    );
    throw error;
  }
}

async function upsertBrainVector(
  index: NonNullable<NonNullable<CloudflareBindings["vector"]>["brain"]>,
  vectorId: string,
  accountId: string,
  hmacSecret: string,
  target: Readonly<{
    action: "upsert";
    statement: string;
    category: string;
    derivation: "ai" | "deterministic";
    itemRevision: number;
    previousVectorId?: string;
  }>,
  workerConfig: WorkerConfig,
) {
  if (!workerConfig.googleVertexAiApiKey) {
    throw new Error("Gemini embedding credentials are not configured");
  }
  const values = await embedDocument(
    createGeminiClient({
      googleVertexAiApiKey: workerConfig.googleVertexAiApiKey,
    }),
    {
      model: workerConfig.geminiEmbeddingModel,
      contents: target.statement,
      dimensions: BRAIN_VECTOR_DIMENSIONS,
    },
  );
  if (!values) throw new Error("Gemini embedding response is invalid");
  const ownerScope = await createBrainOwnerScope(hmacSecret, accountId);
  return index.upsert([
    {
      id: vectorId,
      values,
      metadata: {
        owner_scope: ownerScope,
        category: target.category,
        derivation: target.derivation,
        embedding_version: EMBEDDING_VERSION,
        schema_version: METADATA_SCHEMA_VERSION,
      },
    },
  ]);
}

function mutationIdOf(mutation: { mutationId?: string; ids?: string[] }): string {
  if (mutation.mutationId) return mutation.mutationId;
  // Wranglerの旧binding型では受付済みIDだけが返る。本文を含まない受付記録として保持する。
  if (mutation.ids) return `accepted:${mutation.ids.join(",")}`;
  throw new Error("Vectorize mutation response is invalid");
}
