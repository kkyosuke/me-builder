import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";
import { renderWranglerConfigs } from "./wrangler";

function manifest(environment: "preview" | "production", databaseId: string) {
  const suffix = environment;
  return parseManifest({
    environment,
    database: { id: databaseId, name: `me-builder-db-${suffix}` },
    queues: {
      webhook: { id: "1", name: `me-builder-webhook-queue-${suffix}` },
      webhookDeadLetter: { id: "2", name: `me-builder-webhook-dlq-${suffix}` },
      chatTurn: { id: "3", name: `me-builder-chat-turn-queue-${suffix}` },
      chatTurnDeadLetter: { id: "4", name: `me-builder-chat-turn-dlq-${suffix}` },
      brainCheckpoint: { id: "5", name: `me-builder-brain-checkpoint-queue-${suffix}` },
      brainCheckpointDeadLetter: { id: "6", name: `me-builder-brain-checkpoint-dlq-${suffix}` },
      brainVector: { id: "7", name: `me-builder-brain-vector-queue-${suffix}` },
      brainVectorDeadLetter: { id: "8", name: `me-builder-brain-vector-dlq-${suffix}` },
    },
  });
}

describe("renderWranglerConfigs", () => {
  it("renders Pulumi D1 outputs and queue names into every consumer config", () => {
    const configs = renderWranglerConfigs(
      manifest("preview", "preview-id"),
      manifest("production", "production-id"),
    );
    expect(configs.worker).toContain('database_id = "preview-id"');
    expect(configs.worker).toContain('binding = "BRAIN_VECTOR_QUEUE"');
    expect(configs.worker).toContain('binding = "BRAIN_VECTOR_INDEX"');
    expect(configs.api).toContain('queue = "me-builder-webhook-queue-preview"');
    expect(configs.api).toContain('index_name = "me-builder-brain-preview"');
    expect(configs.api).not.toContain('index_name = "me-builder-brain-production"');
    expect(configs.mcp).toContain('database_id = "production-id"');
    expect(configs.lib).toContain("[[env.preview.d1_databases]]");
  });
});
