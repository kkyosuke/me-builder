import { describe, expect, it, vi } from "vitest";
import { parseManifest } from "../infra/src/manifest";
import { verifyCloudflareInfrastructure } from "./verify-cloudflare-infrastructure";

const queueNames = {
  webhook: "me-builder-webhook-queue-production",
  webhookDeadLetter: "me-builder-webhook-dlq-production",
  billing: "me-builder-billing-queue-production",
  billingDeadLetter: "me-builder-billing-dlq-production",
  chatTurn: "me-builder-chat-turn-queue-production",
  chatTurnDeadLetter: "me-builder-chat-turn-dlq-production",
  brainCheckpoint: "me-builder-brain-checkpoint-queue-production",
  brainCheckpointDeadLetter: "me-builder-brain-checkpoint-dlq-production",
  profileSummary: "me-builder-profile-summary-queue-production",
  profileSummaryDeadLetter: "me-builder-profile-summary-dlq-production",
  brainVector: "me-builder-brain-vector-queue-production",
  brainVectorDeadLetter: "me-builder-brain-vector-dlq-production",
  dailyPrompt: "me-builder-daily-prompt-queue-production",
  dailyPromptDeadLetter: "me-builder-daily-prompt-dlq-production",
} as const;

const manifest = parseManifest({
  environment: "production",
  baseDomain: "example.com",
  database: { id: "database-id", name: "me-builder-db-production" },
  avatarBucket: { name: "me-builder-avatar-production" },
  queues: Object.fromEntries(Object.entries(queueNames).map(([key, name]) => [key, { name }])),
});

function success(result: unknown): Response {
  return new Response(JSON.stringify({ success: true, result }), {
    headers: { "Content-Type": "application/json" },
  });
}

function remoteState(overrides: { databaseId?: string; queueNames?: string[] } = {}) {
  return {
    databases: [
      {
        uuid: overrides.databaseId ?? "database-id",
        name: "me-builder-db-production",
      },
    ],
    buckets: { buckets: [{ name: "me-builder-avatar-production" }] },
    namespaces: [{ id: "session-id", title: "me-builder-session-production" }],
    queues: (overrides.queueNames ?? Object.values(queueNames)).map((queue_name, index) => ({
      queue_id: `queue-${index}`,
      queue_name,
    })),
    vectorize: {
      name: "me-builder-brain-production",
      config: { dimensions: 768, metric: "cosine" },
    },
  };
}

function fetcherFor(state = remoteState()) {
  return vi.fn<typeof fetch>(async (request) => {
    const pathname = new URL(String(request)).pathname;
    if (pathname.endsWith("/d1/database")) return success(state.databases);
    if (pathname.endsWith("/r2/buckets")) return success(state.buckets);
    if (pathname.endsWith("/storage/kv/namespaces")) return success(state.namespaces);
    if (pathname.endsWith("/queues")) return success(state.queues);
    if (pathname.includes("/vectorize/v2/indexes/")) return success(state.vectorize);
    if (pathname.includes("/workers/scripts/")) return success({ bindings: [] });
    return new Response(null, { status: 404 });
  });
}

describe("verifyCloudflareInfrastructure", () => {
  it("重要resourceと設定がmanifestどおりならread-only検証を完了する", async () => {
    const fetcher = fetcherFor();
    await expect(
      verifyCloudflareInfrastructure({
        accountId: "account-id",
        token: "secret-token",
        manifest,
        fetcher,
      }),
    ).resolves.toEqual({
      checks: [
        "d1-manifest-id",
        "private-r2-bucket",
        "session-kv",
        "queue-set",
        "vectorize-schema",
        "worker-deployments",
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(8);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.method).toBe("GET");
    }
  });

  it("同名D1への作り直しをID driftとして検出する", async () => {
    await expect(
      verifyCloudflareInfrastructure({
        accountId: "account-id",
        token: "secret-token",
        manifest,
        fetcher: fetcherFor(remoteState({ databaseId: "different-id" })),
      }),
    ).rejects.toThrow("D1 database ID drifted");
  });

  it("Queueが1つでも欠ければ成功にしない", async () => {
    const names = Object.values(queueNames).filter(
      (name) => name !== "me-builder-billing-dlq-production",
    );
    await expect(
      verifyCloudflareInfrastructure({
        accountId: "account-id",
        token: "secret-token",
        manifest,
        fetcher: fetcherFor(remoteState({ queueNames: names })),
      }),
    ).rejects.toThrow("Queue is missing: me-builder-billing-dlq-production");
  });

  it("API拒否をresource欠落へ丸めない", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ success: false, result: null, errors: [{ message: "denied" }] }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          ),
      );
    await expect(
      verifyCloudflareInfrastructure({
        accountId: "account-id",
        token: "secret-token",
        manifest,
        fetcher,
      }),
    ).rejects.toThrow("Cloudflare read-only verification failed (403): denied");
  });
});
