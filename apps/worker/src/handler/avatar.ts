import { accountDataFor } from "@me-builder/lib";
import type { AvatarQueueMessage, Message } from "@me-builder/shared";
import { logger } from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import {
  createGeminiClient,
  detectPerson,
  generateAvatarImage,
} from "../infrastructure/gemini-client";

const LEASE_MS = 10 * 60 * 1000;
const CANDIDATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const STYLES = [
  "やわらかなフラットイラスト、朝焼けの配色",
  "落ち着いたデジタルペイント、星空の配色",
  "明るい水彩イラスト、若葉の配色",
  "清潔感のある3Dイラスト、水面の配色",
] as const;

function errorDetails(error: unknown): {
  errorName: string;
  errorMessage?: string;
  errorStatus?: number;
} {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const errorMessage = error instanceof Error ? error.message.slice(0, 500) : undefined;
  const errorStatus =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined;
  return {
    errorName,
    ...(errorMessage ? { errorMessage } : {}),
    ...(errorStatus !== undefined ? { errorStatus } : {}),
  };
}

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([bytes.slice().buffer]).stream();
}

async function normalizeGeneratedImage(
  images: ImagesBinding,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const result = await images
    .input(stream(bytes))
    .transform({ width: 1024, height: 1024, fit: "cover", gravity: "face" })
    .output({ format: "image/webp", quality: 85, anim: false });
  const response = result.response();
  if (!response.ok) throw new Error("Generated avatar image could not be normalized");
  return new Uint8Array(await response.arrayBuffer());
}

export async function processAvatarMessage(
  message: Message<AvatarQueueMessage>,
  cf: CloudflareBindings,
  config: WorkerConfig,
): Promise<void> {
  const accountData = cf.do.accountData;
  const bucket = cf.avatar?.bucket;
  const images = cf.avatar?.images;
  if (!accountData || !bucket || !images) throw new Error("Avatar bindings are not configured");
  const object = accountDataFor(accountData, message.body.accountId);
  const at = new Date();
  const acquired = await object.execute(
    "avatar.acquireTask",
    message.body.jobId,
    message.body.operation,
    new Date(at.getTime() + LEASE_MS),
    at,
  );
  if (acquired.type === "skip") {
    if (acquired.reason === "leased") {
      const delaySeconds = Math.max(
        1,
        Math.ceil((acquired.retryAt.getTime() - at.getTime()) / 1000),
      );
      message.retry({ delaySeconds });
      return;
    }
    message.ack();
    return;
  }

  try {
    if (!config.googleAiStudioApiKey || !config.cloudflareAiGatewayToken) {
      throw new Error("Gemini credentials are not configured");
    }
    const source = await bucket.get(acquired.job.referenceObjectKey);
    if (!source) throw new Error("Avatar reference image was not found");
    const sourceBytes = new Uint8Array(await source.arrayBuffer());
    const client = createGeminiClient({
      googleAiStudioApiKey: config.googleAiStudioApiKey,
      cloudflareAiGatewayToken: config.cloudflareAiGatewayToken,
      cloudflareAiGatewayBaseUrl: config.cloudflareAiGatewayBaseUrl,
    });

    if (message.body.operation === "person-check") {
      const hasPerson = await detectPerson(client, {
        model: config.geminiModel,
        bytes: sourceBytes,
        mimeType: acquired.job.referenceContentType,
      });
      const checkedJob = await object.execute(
        "avatar.finishPersonCheck",
        message.body.jobId,
        hasPerson,
      );
      if (!hasPerson || !checkedJob) {
        message.ack();
        return;
      }

      const started = await object.execute("avatar.startGeneration", message.body.jobId);
      if (started.type === "rate-limited") {
        await object.execute("avatar.failJob", message.body.jobId, "generation_rate_limited");
        message.ack();
        return;
      }
      if (started.type !== "accepted" || !started.job.queuePending) {
        message.ack();
        return;
      }

      try {
        const queue = cf.queue.avatar;
        if (!queue) throw new Error("Avatar Queue binding is not configured");
        await queue.send({
          type: "avatar",
          operation: "generate",
          accountId: message.body.accountId,
          jobId: message.body.jobId,
        });
        await object.execute("avatar.markEnqueued", message.body.jobId, "generate");
      } catch (error) {
        try {
          await object.execute("avatar.recordEnqueueFailure", message.body.jobId, "generate");
        } catch (recordError) {
          logger.error(
            { errorName: recordError instanceof Error ? recordError.name : "UnknownError" },
            "Automatic avatar generation enqueue failure could not be recorded",
          );
        }
        logger.warn(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Automatic avatar generation enqueue failed; AccountData alarm will retry",
        );
      }
      message.ack();
      return;
    }

    let completed = acquired.job.candidates.length;
    for (const style of STYLES.slice(completed)) {
      try {
        const generated = await generateAvatarImage(client, {
          model: config.geminiImageModel,
          bytes: sourceBytes,
          mimeType: acquired.job.referenceContentType,
          style,
        });
        const candidateBytes = await normalizeGeneratedImage(images, generated.bytes);
        const candidateId = crypto.randomUUID();
        const objectKey = `accounts/${message.body.accountId}/avatar/jobs/${message.body.jobId}/candidates/${candidateId}.webp`;
        await bucket.put(objectKey, candidateBytes, {
          httpMetadata: { contentType: "image/webp" },
        });
        const createdAt = new Date();
        const accepted = await object.execute("avatar.addCandidate", {
          id: candidateId,
          jobId: message.body.jobId,
          objectKey,
          contentType: "image/webp",
          createdAt,
          expiresAt: new Date(createdAt.getTime() + CANDIDATE_RETENTION_MS),
          selectedAt: null,
        });
        if (!accepted) {
          await bucket.delete(objectKey);
          message.ack();
          return;
        }
        completed += 1;
      } catch (error) {
        logger.warn(
          { ...errorDetails(error), model: config.geminiImageModel },
          "One avatar candidate generation failed",
        );
      }
    }
    if (completed === 0) throw new Error("No avatar candidates were generated");
    await object.execute("avatar.finishGeneration", message.body.jobId, config.geminiImageModel);
    message.ack();
  } catch (error) {
    const terminal = message.attempts >= MAX_ATTEMPTS;
    await object.execute(
      "avatar.releaseTask",
      message.body.jobId,
      message.body.operation,
      terminal,
      message.body.operation === "generate" ? "generation_failed" : "person_check_failed",
    );
    logger.error(
      {
        operation: message.body.operation,
        attempt: message.attempts,
        ...errorDetails(error),
      },
      "Avatar processing failed",
    );
    if (terminal) {
      message.ack();
      return;
    }
    throw error;
  }
}
