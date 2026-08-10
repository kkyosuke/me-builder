import { accountDataFor } from "@me-builder/lib";
import {
  type AvatarQueueMessage,
  type Message,
  OperationalError,
  type OperationalErrorDescriptor,
  type OperationalOutcome,
  type QueueDisposition,
  describeQueueMessageResult,
  logger,
  operationalLogLevel,
  toOperationalError,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import {
  createGeminiClient,
  detectPerson,
  generateAvatarImage,
} from "../infrastructure/gemini-client";

const LEASE_MS = 10 * 60 * 1000;
const CANDIDATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** wrangler.tomlのmax_retries=3に初回配送を加えた最大試行回数。 */
export const AVATAR_MAX_ATTEMPTS = 4;
const STYLES = [
  "やわらかなフラットイラスト、朝焼けの配色",
  "落ち着いたデジタルペイント、星空の配色",
  "明るい水彩イラスト、若葉の配色",
  "清潔感のある3Dイラスト、水面の配色",
] as const;

type AvatarTerminalDetails = {
  outcome: OperationalOutcome;
  disposition: QueueDisposition;
  stage: string;
  resultCode?: string;
  error?: unknown;
  candidateSuccessCount?: number;
  candidateFailureCount?: number;
};

/** ack/retryを決める境界だけが、アバター処理の終端ログを1件出す。 */
function logTerminal(
  message: Message<AvatarQueueMessage>,
  config: WorkerConfig,
  startedAt: number,
  details: AvatarTerminalDetails,
): void {
  const durationMs = Date.now() - startedAt;
  const safeError = details.error
    ? toSafeOperationalErrorFields(details.error, {
        code: "UNEXPECTED_AVATAR_PROCESSING_ERROR",
        category: "unknown",
        stage: details.stage,
        retryable: true,
      })
    : undefined;
  const stage = safeError?.stage ?? details.stage;
  const fields = {
    event:
      details.outcome === "failed" || details.error
        ? "queue.message.failed"
        : "queue.message.completed",
    service: "worker",
    environment: config.environment,
    component: "avatar",
    traceId: message.body.traceId ?? message.body.jobId,
    queueMessageId: message.id,
    messageType: "avatar",
    operation: message.body.operation,
    attempt: message.attempts,
    outcome: details.outcome,
    disposition: details.disposition,
    stage,
    ...(details.resultCode ? { resultCode: details.resultCode } : {}),
    ...(details.candidateSuccessCount === undefined
      ? {}
      : { candidateSuccessCount: details.candidateSuccessCount }),
    ...(details.candidateFailureCount === undefined
      ? {}
      : { candidateFailureCount: details.candidateFailureCount }),
    ...(safeError ?? {}),
    durationMs,
  };
  const description = describeQueueMessageResult({
    flow: "avatar",
    outcome: details.outcome,
    disposition: details.disposition,
    stage,
    attempt: message.attempts,
    maxAttempts: AVATAR_MAX_ATTEMPTS,
    durationMs,
    resultCode: details.resultCode,
    error: safeError,
  });
  const level = operationalLogLevel(details.outcome, Boolean(details.error));
  if (level === "error") logger.error(fields, description);
  else if (level === "info") logger.info(fields, description);
  else logger.warn(fields, description);
}

async function atBoundary<T>(
  operation: () => Promise<T>,
  descriptor: OperationalErrorDescriptor,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toOperationalError(error, descriptor);
  }
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
  const startedAt = Date.now();
  const accountData = cf.do.accountData;
  const bucket = cf.avatar?.bucket;
  const images = cf.avatar?.images;
  if (!accountData || !bucket || !images) {
    throw new OperationalError({
      code: "AVATAR_BINDING_MISSING",
      category: "configuration",
      stage: "avatar.configure",
      retryable: true,
    });
  }
  const object = accountDataFor(accountData, message.body.accountId);
  const at = new Date();
  const acquired = await atBoundary(
    () =>
      object.execute(
        "avatar.acquireTask",
        message.body.jobId,
        message.body.operation,
        new Date(at.getTime() + LEASE_MS),
        at,
      ),
    {
      code: "AVATAR_TASK_ACQUIRE_FAILED",
      category: "dependency",
      stage: "task.acquire",
      retryable: true,
      dependency: "account-data",
    },
  );
  if (acquired.type === "skip") {
    if (acquired.reason === "leased") {
      const delaySeconds = Math.max(
        1,
        Math.ceil((acquired.retryAt.getTime() - at.getTime()) / 1000),
      );
      message.retry({ delaySeconds });
      logTerminal(message, config, startedAt, {
        outcome: "deferred",
        disposition: "retry",
        stage: "task.acquire",
        resultCode: "AVATAR_TASK_LEASE_BUSY",
      });
      return;
    }
    message.ack();
    logTerminal(message, config, startedAt, {
      outcome: "discarded",
      disposition: "ack",
      stage: "task.acquire",
      resultCode: `AVATAR_TASK_${acquired.reason.replaceAll("-", "_").toUpperCase()}`,
    });
    return;
  }

  try {
    if (!config.googleAiStudioApiKey || !config.cloudflareAiGatewayToken) {
      throw new OperationalError({
        code: "GEMINI_CREDENTIALS_MISSING",
        category: "configuration",
        stage: "avatar.configure",
        retryable: true,
        dependency: "google-ai",
      });
    }
    const source = await atBoundary(() => bucket.get(acquired.job.referenceObjectKey), {
      code: "AVATAR_REFERENCE_LOAD_FAILED",
      category: "dependency",
      stage: "reference.load",
      retryable: true,
      dependency: "r2",
    });
    if (!source) {
      throw new OperationalError({
        code: "AVATAR_REFERENCE_NOT_FOUND",
        category: "invariant",
        stage: "reference.load",
        retryable: false,
        dependency: "r2",
      });
    }
    const sourceBytes = await atBoundary(async () => new Uint8Array(await source.arrayBuffer()), {
      code: "AVATAR_REFERENCE_READ_FAILED",
      category: "dependency",
      stage: "reference.load",
      retryable: true,
      dependency: "r2",
    });
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
      const checkedJob = await atBoundary(
        () => object.execute("avatar.finishPersonCheck", message.body.jobId, hasPerson),
        {
          code: "AVATAR_PERSON_CHECK_STORE_FAILED",
          category: "dependency",
          stage: "person-check.store",
          retryable: true,
          dependency: "account-data",
        },
      );
      if (!hasPerson || !checkedJob) {
        message.ack();
        logTerminal(message, config, startedAt, {
          outcome: "discarded",
          disposition: "ack",
          stage: "person-check.store",
          resultCode: hasPerson ? "AVATAR_JOB_NOT_ACTIVE" : "AVATAR_PERSON_NOT_DETECTED",
        });
        return;
      }

      const started = await atBoundary(
        () =>
          object.execute(
            "avatar.startGeneration",
            message.body.jobId,
            config.avatarGenerationRateLimit,
          ),
        {
          code: "AVATAR_GENERATION_START_FAILED",
          category: "dependency",
          stage: "generation.start",
          retryable: true,
          dependency: "account-data",
        },
      );
      if (started.type === "rate-limited") {
        await atBoundary(
          () => object.execute("avatar.failJob", message.body.jobId, "generation_rate_limited"),
          {
            code: "AVATAR_RATE_LIMIT_STORE_FAILED",
            category: "dependency",
            stage: "generation.start",
            retryable: true,
            dependency: "account-data",
          },
        );
        message.ack();
        logTerminal(message, config, startedAt, {
          outcome: "discarded",
          disposition: "ack",
          stage: "generation.start",
          resultCode: "AVATAR_GENERATION_RATE_LIMITED",
        });
        return;
      }
      if (started.type !== "accepted" || !started.job.queuePending) {
        message.ack();
        logTerminal(message, config, startedAt, {
          outcome: "discarded",
          disposition: "ack",
          stage: "generation.start",
          resultCode: "AVATAR_GENERATION_NOT_PENDING",
        });
        return;
      }

      let enqueueError: unknown;
      try {
        const queue = cf.queue.avatar;
        if (!queue) {
          throw new OperationalError({
            code: "AVATAR_QUEUE_BINDING_MISSING",
            category: "configuration",
            stage: "generation.enqueue",
            retryable: true,
            dependency: "cloudflare-queues",
          });
        }
        await atBoundary(
          () =>
            queue.send({
              type: "avatar",
              traceId: message.body.traceId ?? message.body.jobId,
              operation: "generate",
              accountId: message.body.accountId,
              jobId: message.body.jobId,
            }),
          {
            code: "AVATAR_GENERATION_ENQUEUE_FAILED",
            category: "dependency",
            stage: "generation.enqueue",
            retryable: true,
            dependency: "cloudflare-queues",
          },
        );
        await atBoundary(
          () => object.execute("avatar.markEnqueued", message.body.jobId, "generate"),
          {
            code: "AVATAR_ENQUEUE_STATE_STORE_FAILED",
            category: "dependency",
            stage: "generation.enqueue",
            retryable: true,
            dependency: "account-data",
          },
        );
      } catch (error) {
        enqueueError = error;
        try {
          await atBoundary(
            () => object.execute("avatar.recordEnqueueFailure", message.body.jobId, "generate"),
            {
              code: "AVATAR_ENQUEUE_RETRY_STORE_FAILED",
              category: "dependency",
              stage: "generation.enqueue",
              retryable: true,
              dependency: "account-data",
            },
          );
        } catch (recordError) {
          enqueueError = recordError;
        }
      }
      message.ack();
      logTerminal(message, config, startedAt, {
        outcome: enqueueError ? "deferred" : "succeeded",
        disposition: "ack",
        stage: "generation.enqueue",
        ...(enqueueError
          ? { resultCode: "AVATAR_GENERATION_ENQUEUE_DEFERRED", error: enqueueError }
          : {}),
      });
      return;
    }

    let completed = acquired.job.candidates.length;
    let candidateSuccessCount = 0;
    let candidateFailureCount = 0;
    let representativeError: unknown;
    for (const style of STYLES.slice(completed)) {
      try {
        const generated = await generateAvatarImage(client, {
          model: config.geminiImageModel,
          bytes: sourceBytes,
          mimeType: acquired.job.referenceContentType,
          style,
        });
        const candidateBytes = await atBoundary(
          () => normalizeGeneratedImage(images, generated.bytes),
          {
            code: "AVATAR_IMAGE_NORMALIZATION_FAILED",
            category: "dependency",
            stage: "candidate.normalize",
            retryable: true,
            dependency: "cloudflare-images",
          },
        );
        const candidateId = crypto.randomUUID();
        const objectKey = `accounts/${message.body.accountId}/avatar/jobs/${message.body.jobId}/candidates/${candidateId}.webp`;
        await atBoundary(
          () =>
            bucket.put(objectKey, candidateBytes, {
              httpMetadata: { contentType: "image/webp" },
            }),
          {
            code: "AVATAR_CANDIDATE_STORE_FAILED",
            category: "dependency",
            stage: "candidate.store",
            retryable: true,
            dependency: "r2",
          },
        );
        const createdAt = new Date();
        const accepted = await atBoundary(
          () =>
            object.execute("avatar.addCandidate", {
              id: candidateId,
              jobId: message.body.jobId,
              objectKey,
              contentType: "image/webp",
              createdAt,
              expiresAt: new Date(createdAt.getTime() + CANDIDATE_RETENTION_MS),
              selectedAt: null,
            }),
          {
            code: "AVATAR_CANDIDATE_STATE_STORE_FAILED",
            category: "dependency",
            stage: "candidate.store",
            retryable: true,
            dependency: "account-data",
          },
        );
        if (!accepted) {
          await atBoundary(() => bucket.delete(objectKey), {
            code: "AVATAR_ORPHAN_CANDIDATE_DELETE_FAILED",
            category: "dependency",
            stage: "candidate.cleanup",
            retryable: true,
            dependency: "r2",
          });
          message.ack();
          logTerminal(message, config, startedAt, {
            outcome: "discarded",
            disposition: "ack",
            stage: "candidate.store",
            resultCode: "AVATAR_JOB_NOT_GENERATING",
            candidateSuccessCount,
            candidateFailureCount,
          });
          return;
        }
        completed += 1;
        candidateSuccessCount += 1;
      } catch (error) {
        representativeError ??= error;
        candidateFailureCount += 1;
      }
    }
    if (completed === 0) {
      throw (
        representativeError ??
        new OperationalError({
          code: "AVATAR_CANDIDATE_GENERATION_FAILED",
          category: "dependency",
          stage: "avatar.generate",
          retryable: true,
          dependency: "google-ai",
        })
      );
    }
    await atBoundary(
      () => object.execute("avatar.finishGeneration", message.body.jobId, config.geminiImageModel),
      {
        code: "AVATAR_GENERATION_FINISH_STORE_FAILED",
        category: "dependency",
        stage: "generation.finish",
        retryable: true,
        dependency: "account-data",
      },
    );
    message.ack();
    logTerminal(message, config, startedAt, {
      outcome: candidateFailureCount > 0 ? "degraded" : "succeeded",
      disposition: "ack",
      stage: "generation.finish",
      ...(candidateFailureCount > 0
        ? {
            resultCode: "AVATAR_CANDIDATES_PARTIALLY_GENERATED",
            error: representativeError,
          }
        : {}),
      candidateSuccessCount,
      candidateFailureCount,
    });
  } catch (error) {
    const terminal =
      (error instanceof OperationalError && !error.retryable) ||
      message.attempts >= AVATAR_MAX_ATTEMPTS;
    await atBoundary(
      () =>
        object.execute(
          "avatar.releaseTask",
          message.body.jobId,
          message.body.operation,
          terminal,
          message.body.operation === "generate" ? "generation_failed" : "person_check_failed",
        ),
      {
        code: "AVATAR_TASK_RELEASE_FAILED",
        category: "dependency",
        stage: "task.release",
        retryable: true,
        dependency: "account-data",
      },
    );
    if (!terminal) throw error;

    message.ack();
    logTerminal(message, config, startedAt, {
      outcome: "failed",
      disposition: "ack",
      stage: message.body.operation === "generate" ? "avatar.generate" : "avatar.person-detect",
      error,
    });
  }
}
