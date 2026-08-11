import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";
import { renderWranglerConfigs } from "./wrangler";

function manifest(environment: "preview" | "production", databaseId: string) {
  const suffix = environment;
  return parseManifest({
    environment,
    baseDomain: environment === "preview" ? "preview.example.com" : "example.com",
    database: { id: databaseId, name: `me-builder-db-${suffix}` },
    avatarBucket: { name: `me-builder-avatar-${suffix}` },
    queues: {
      webhook: { id: "1", name: `me-builder-webhook-queue-${suffix}` },
      webhookDeadLetter: { id: "2", name: `me-builder-webhook-dlq-${suffix}` },
      chatTurn: { id: "3", name: `me-builder-chat-turn-queue-${suffix}` },
      chatTurnDeadLetter: { id: "4", name: `me-builder-chat-turn-dlq-${suffix}` },
      brainCheckpoint: { id: "5", name: `me-builder-brain-checkpoint-queue-${suffix}` },
      brainCheckpointDeadLetter: { id: "6", name: `me-builder-brain-checkpoint-dlq-${suffix}` },
      profileSummary: { id: "7", name: `me-builder-profile-summary-queue-${suffix}` },
      profileSummaryDeadLetter: { id: "8", name: `me-builder-profile-summary-dlq-${suffix}` },
      brainVector: { id: "9", name: `me-builder-brain-vector-queue-${suffix}` },
      brainVectorDeadLetter: { id: "10", name: `me-builder-brain-vector-dlq-${suffix}` },
    },
  });
}

describe("renderWranglerConfigs", () => {
  it("renders Pulumi D1, private avatar R2 and queue outputs into consumer configs", () => {
    const configs = renderWranglerConfigs(
      manifest("preview", "preview-id"),
      manifest("production", "production-id"),
    );
    expect(configs.worker).toContain('database_id = "preview-id"');
    expect(configs.api).toContain('queue = "me-builder-webhook-queue-preview"');
    expect(configs.api).toContain('binding = "PROFILE_SUMMARY_QUEUE"');
    expect(configs.worker).toContain('queue = "me-builder-profile-summary-queue-production"');
    expect(configs.worker).toContain('binding = "BRAIN_VECTOR_QUEUE"');
    expect(configs.worker).toContain('binding = "BRAIN_VECTOR_INDEX"');
    expect(configs.api).toContain('index_name = "me-builder-brain-preview"');
    expect(configs.api).not.toContain('index_name = "me-builder-brain-production"');
    expect(configs.api).toContain('bucket_name = "me-builder-avatar-preview"');
    expect(configs.api).toContain('bucket_name = "me-builder-avatar-production"');
    expect(configs.api).toContain('bucket_name = "me-builder-avatar-local"');
    expect(configs.api).toContain('WEB_ORIGIN = "https://preview.example.com"');
    expect(configs.api).toContain('WEB_ORIGIN = "https://example.com"');
    expect(configs.api).toContain('WEB_ORIGIN = "http://localhost:5173"');
    expect(configs.api).toContain('{ pattern = "api.preview.example.com", custom_domain = true }');
    expect(configs.mcp).toContain('{ pattern = "mcp.example.com", custom_domain = true }');
    expect(configs.mcp).toContain('database_id = "production-id"');
    expect(configs.lib).toContain("[[env.preview.d1_databases]]");
  });
});
