import type { AccountDataNamespace, AccountDataOperation } from "@me-builder/lib";
import { type AvatarQueueMessage, type Message, logger } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudflareBindings, WorkerConfig } from "../config";

const gemini = vi.hoisted(() => ({
  createGeminiClient: vi.fn(() => ({ models: {} })),
  detectPerson: vi.fn(),
  generateAvatarImage: vi.fn(),
}));
vi.mock("../infrastructure/gemini-client", () => gemini);

import { processAvatarMessage } from "./avatar";

const infoLog = vi.spyOn(logger, "info").mockImplementation(() => undefined);
const warnLog = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);

const source = new Uint8Array([1, 2, 3]).buffer;
const generated = new Uint8Array([4, 5, 6]);
const normalized = new Uint8Array([7, 8, 9]).buffer;

function message(operation: AvatarQueueMessage["operation"], attempts = 1) {
  return {
    id: "avatar-message-1",
    timestamp: new Date("2026-08-10T00:00:00.000Z"),
    body: {
      type: "avatar",
      traceId: "avatar-trace-1",
      operation,
      accountId: "account-1",
      jobId: "job-1",
    },
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  } as unknown as Message<AvatarQueueMessage>;
}

function dependencies(
  execute: (operation: AccountDataOperation, ...args: unknown[]) => Promise<unknown>,
) {
  const accountData = {
    getByName: () => ({
      execute: (_accountId: string, operation: AccountDataOperation, ...args: unknown[]) =>
        execute(operation, ...args),
    }),
  } as unknown as AccountDataNamespace;
  const bucket = {
    get: vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(source) }),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const output = vi.fn(() => ({ response: () => new Response(normalized.slice(0)) }));
  const transform = vi.fn(() => ({ output }));
  const images = { input: vi.fn(() => ({ transform })) };
  const avatarQueue = { send: vi.fn().mockResolvedValue(undefined) };
  const cf = {
    do: { accountData },
    queue: { avatar: avatarQueue },
    avatar: { bucket, images },
  } as unknown as CloudflareBindings;
  return { cf, bucket, images, avatarQueue };
}

const config = {
  environment: "test",
  googleAiStudioApiKey: "google-key",
  cloudflareAiGatewayToken: "gateway-token",
  cloudflareAiGatewayBaseUrl: "https://gateway.example.com/google-ai-studio",
  geminiModel: "gemini-person-model",
  geminiImageModel: "gemini-image-model",
  avatarGenerationRateLimit: 0,
} as WorkerConfig;

describe("avatar queue handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("人物を確認できなければ候補を生成せずnot_personへ完了する", async () => {
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation === "avatar.acquireTask") {
        return {
          type: "acquired",
          job: {
            referenceObjectKey: "reference.webp",
            referenceContentType: "image/webp",
          },
        };
      }
      return null;
    });
    const { cf } = dependencies(execute);
    gemini.detectPerson.mockResolvedValue(false);
    const queueMessage = message("person-check");

    await processAvatarMessage(queueMessage, cf, config);

    expect(gemini.detectPerson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: "gemini-person-model", mimeType: "image/webp" }),
    );
    expect(execute).toHaveBeenCalledWith("avatar.finishPersonCheck", "job-1", false);
    expect(gemini.generateAvatarImage).not.toHaveBeenCalled();
    expect(queueMessage.ack).toHaveBeenCalledOnce();
  });

  it("人物を確認できたら同じジョブの候補生成を自動で投入する", async () => {
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation === "avatar.acquireTask") {
        return {
          type: "acquired",
          job: {
            referenceObjectKey: "reference.webp",
            referenceContentType: "image/webp",
          },
        };
      }
      if (operation === "avatar.finishPersonCheck") return { status: "verified" };
      if (operation === "avatar.startGeneration") {
        return { type: "accepted", job: { queuePending: true } };
      }
      return null;
    });
    const { cf, avatarQueue } = dependencies(execute);
    gemini.detectPerson.mockResolvedValue(true);
    const queueMessage = message("person-check");

    await processAvatarMessage(queueMessage, cf, config);

    expect(execute).toHaveBeenCalledWith("avatar.startGeneration", "job-1", 0);
    expect(avatarQueue.send).toHaveBeenCalledWith({
      type: "avatar",
      traceId: "avatar-trace-1",
      operation: "generate",
      accountId: "account-1",
      jobId: "job-1",
    });
    expect(execute).toHaveBeenCalledWith("avatar.markEnqueued", "job-1", "generate");
    expect(queueMessage.ack).toHaveBeenCalledOnce();
  });

  it("自動生成の投入に失敗してもalarm再投入用の状態を記録する", async () => {
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation === "avatar.acquireTask") {
        return {
          type: "acquired",
          job: {
            referenceObjectKey: "reference.webp",
            referenceContentType: "image/webp",
          },
        };
      }
      if (operation === "avatar.finishPersonCheck") return { status: "verified" };
      if (operation === "avatar.startGeneration") {
        return { type: "accepted", job: { queuePending: true } };
      }
      return null;
    });
    const { cf, avatarQueue } = dependencies(execute);
    avatarQueue.send.mockRejectedValue(new Error("queue unavailable"));
    gemini.detectPerson.mockResolvedValue(true);
    const queueMessage = message("person-check");

    await processAvatarMessage(queueMessage, cf, config);

    expect(execute).toHaveBeenCalledWith("avatar.recordEnqueueFailure", "job-1", "generate");
    expect(queueMessage.ack).toHaveBeenCalledOnce();
  });

  it("自動生成がAccount上限なら生成失敗として完了する", async () => {
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation === "avatar.acquireTask") {
        return {
          type: "acquired",
          job: {
            referenceObjectKey: "reference.webp",
            referenceContentType: "image/webp",
          },
        };
      }
      if (operation === "avatar.finishPersonCheck") return { status: "verified" };
      if (operation === "avatar.startGeneration") {
        return { type: "rate-limited", retryAt: new Date() };
      }
      return null;
    });
    const { cf, avatarQueue } = dependencies(execute);
    gemini.detectPerson.mockResolvedValue(true);
    const queueMessage = message("person-check");

    await processAvatarMessage(queueMessage, cf, config);

    expect(execute).toHaveBeenCalledWith("avatar.failJob", "job-1", "generation_rate_limited");
    expect(avatarQueue.send).not.toHaveBeenCalled();
    expect(queueMessage.ack).toHaveBeenCalledOnce();
  });

  it("人物確認済み画像から4候補を生成し、検査済みWebPだけを保存する", async () => {
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation === "avatar.acquireTask") {
        return {
          type: "acquired",
          job: {
            referenceObjectKey: "reference.webp",
            referenceContentType: "image/webp",
            candidates: [],
          },
        };
      }
      if (operation === "avatar.addCandidate") return true;
      return null;
    });
    const { cf, bucket, images } = dependencies(execute);
    gemini.generateAvatarImage.mockResolvedValue({ bytes: generated, mimeType: "image/png" });
    const queueMessage = message("generate");

    await processAvatarMessage(queueMessage, cf, config);

    expect(gemini.generateAvatarImage).toHaveBeenCalledTimes(4);
    expect(images.input).toHaveBeenCalledTimes(4);
    expect(bucket.put).toHaveBeenCalledTimes(4);
    expect(
      execute.mock.calls.filter(([operation]) => operation === "avatar.addCandidate"),
    ).toHaveLength(4);
    expect(execute).toHaveBeenCalledWith("avatar.finishGeneration", "job-1", "gemini-image-model");
    expect(queueMessage.ack).toHaveBeenCalledOnce();
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "avatar",
        traceId: "avatar-trace-1",
        outcome: "succeeded",
        disposition: "ack",
        candidateSuccessCount: 4,
        candidateFailureCount: 0,
      }),
      expect.stringContaining("[Avatar] succeeded at generation.finish -> ack (attempt 1/4"),
    );
  });

  it("候補ごとの失敗を並べず、縮退成功の終端ログ1件へ集約する", async () => {
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation === "avatar.acquireTask") {
        return {
          type: "acquired",
          job: {
            referenceObjectKey: "reference.webp",
            referenceContentType: "image/webp",
            candidates: [],
          },
        };
      }
      if (operation === "avatar.addCandidate") return true;
      return null;
    });
    const { cf } = dependencies(execute);
    gemini.generateAvatarImage
      .mockRejectedValueOnce(new Error("sensitive provider response"))
      .mockResolvedValue({ bytes: generated, mimeType: "image/png" });
    const queueMessage = message("generate");

    await processAvatarMessage(queueMessage, cf, config);

    expect(warnLog).not.toHaveBeenCalled();
    const terminalLogs = errorLog.mock.calls.filter(
      ([fields]) =>
        typeof fields === "object" &&
        fields !== null &&
        "event" in fields &&
        fields.event === "queue.message.failed",
    );
    expect(terminalLogs).toHaveLength(1);
    expect(terminalLogs[0]?.[0]).toMatchObject({
      outcome: "degraded",
      disposition: "ack",
      candidateSuccessCount: 3,
      candidateFailureCount: 1,
      errorCode: "UNEXPECTED_AVATAR_PROCESSING_ERROR",
    });
    expect(JSON.stringify(terminalLogs)).not.toContain("sensitive provider response");
  });

  it("外部処理が最大回数失敗したら安全な終端ログ1件でfailedへ解放する", async () => {
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation === "avatar.acquireTask") {
        return {
          type: "acquired",
          job: {
            referenceObjectKey: "reference.webp",
            referenceContentType: "image/webp",
            candidates: [],
          },
        };
      }
      return null;
    });
    const { cf } = dependencies(execute);
    gemini.generateAvatarImage.mockRejectedValue(new Error("provider unavailable"));
    const queueMessage = message("generate", 4);

    await processAvatarMessage(queueMessage, cf, config);

    expect(execute).toHaveBeenCalledWith(
      "avatar.releaseTask",
      "job-1",
      "generate",
      true,
      "generation_failed",
    );
    expect(queueMessage.ack).toHaveBeenCalledOnce();
    const terminalLogs = errorLog.mock.calls.filter(
      ([fields]) =>
        typeof fields === "object" &&
        fields !== null &&
        "event" in fields &&
        fields.event === "queue.message.failed",
    );
    expect(terminalLogs).toHaveLength(1);
    expect(terminalLogs[0]?.[0]).toMatchObject({
      component: "avatar",
      traceId: "avatar-trace-1",
      attempt: 4,
      outcome: "failed",
      disposition: "ack",
      errorCode: "UNEXPECTED_AVATAR_PROCESSING_ERROR",
      errorCategory: "unknown",
    });
    expect(terminalLogs[0]?.[1]).toContain(
      "[Avatar] failed at avatar.generate -> ack (attempt 4/4",
    );
    expect(JSON.stringify(terminalLogs)).not.toContain("provider unavailable");
  });

  it("再試行不能な参照画像欠損は初回でfailedへ解放する", async () => {
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation === "avatar.acquireTask") {
        return {
          type: "acquired",
          job: {
            referenceObjectKey: "missing.webp",
            referenceContentType: "image/webp",
            candidates: [],
          },
        };
      }
      return null;
    });
    const { cf, bucket } = dependencies(execute);
    bucket.get.mockResolvedValue(null);
    const queueMessage = message("generate");

    await processAvatarMessage(queueMessage, cf, config);

    expect(execute).toHaveBeenCalledWith(
      "avatar.releaseTask",
      "job-1",
      "generate",
      true,
      "generation_failed",
    );
    expect(queueMessage.ack).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "AVATAR_REFERENCE_NOT_FOUND",
        retryable: false,
        disposition: "ack",
      }),
      expect.stringContaining("[Avatar] failed at reference.load -> ack (attempt 1/4"),
    );
  });

  it("別処理のlease中ならackせずlease期限後へ再配送する", async () => {
    const retryAt = new Date(Date.now() + 30_000);
    const execute = vi.fn(async (operation: AccountDataOperation) => {
      if (operation === "avatar.acquireTask") {
        return { type: "skip", reason: "leased", retryAt };
      }
      return null;
    });
    const { cf } = dependencies(execute);
    const queueMessage = message("generate");

    await processAvatarMessage(queueMessage, cf, config);

    expect(queueMessage.retry).toHaveBeenCalledWith(
      expect.objectContaining({ delaySeconds: expect.any(Number) }),
    );
    expect(queueMessage.ack).not.toHaveBeenCalled();
  });
});
