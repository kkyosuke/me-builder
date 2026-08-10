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
      profileSummary: { id: "7", name: `me-builder-profile-summary-queue-${suffix}` },
      profileSummaryDeadLetter: { id: "8", name: `me-builder-profile-summary-dlq-${suffix}` },
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
    expect(configs.api).toContain('queue = "me-builder-webhook-queue-preview"');
    expect(configs.api).toContain('binding = "PROFILE_SUMMARY_QUEUE"');
    expect(configs.worker).toContain('queue = "me-builder-profile-summary-queue-production"');
    expect(configs.mcp).toContain('database_id = "production-id"');
    expect(configs.lib).toContain("[[env.preview.d1_databases]]");
  });
});
