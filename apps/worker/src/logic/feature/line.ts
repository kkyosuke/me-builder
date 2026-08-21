import { type AccountDataNamespace, D1, accountDataFor, line } from "@me-builder/lib";
import {
  type ConversationCoordinatorNamespace,
  OperationalError,
  type WebhookQueueMessage,
  resolveLineAccountRole,
  toOperationalError,
} from "@me-builder/shared";
import * as v from "valibot";
import type { CloudflareBindings, WorkerConfig } from "../../config";
import { replyLineText } from "../../infrastructure/line-delivery";
import { processPhotoDiaryImage } from "../photo-diary";

export const classifyLineText = line.text.classify;

const LineRoutingSchema = v.object({
  lineTextEvents: v.array(
    v.object({
      eventId: v.string(),
      intent: v.picklist(["diagnosis-request", "diary"]),
    }),
  ),
});

function buildDiagnosisLink(liffId: string): string {
  return `今日の診断に答える\nhttps://liff.line.me/${liffId}`;
}

export function buildDiagnosisReplyText(liffId?: string): string {
  return liffId
    ? buildDiagnosisLink(liffId)
    : "いまは診断のリンクをお渡しできません。時間をおいてもう一度お試しください。";
}

export function buildTermsAcceptanceReplyText(liffId: string): string {
  return `サービスを利用するには、利用規約への同意が必要です。\n内容を確認して同意したあと、メッセージをもう一度送ってください。\nhttps://liff.line.me/${liffId}/terms`;
}

export type LineWebhookProcessingResult = {
  outcome: "succeeded" | "degraded" | "discarded";
  stage: string;
  resultCode?: string;
};

function mergeResult(
  current: LineWebhookProcessingResult,
  next: LineWebhookProcessingResult,
): LineWebhookProcessingResult {
  const rank = { succeeded: 0, discarded: 1, degraded: 2 } as const;
  return rank[next.outcome] >= rank[current.outcome] ? next : current;
}

function getLineEventId(event: {
  webhookEventId?: string;
  message?: { id?: string };
}): string | undefined {
  return event.webhookEventId ?? event.message?.id;
}

/** 署名検証済みLINE eventを原本として保存し、AccountのCoordinatorへ渡す。 */
export async function processLineWebhook(
  payload: unknown,
  db: D1.shared.Client,
  workerConfig: WorkerConfig,
  coordinatorNamespace?: ConversationCoordinatorNamespace,
  accountDataNamespace?: AccountDataNamespace,
  routing?: WebhookQueueMessage["routing"],
  traceId?: string,
  cloudflareBindings?: CloudflareBindings,
  isFinalAttempt = false,
): Promise<LineWebhookProcessingResult> {
  const events = line.webhook.parseEvents(payload);
  let result: LineWebhookProcessingResult = { outcome: "succeeded", stage: "line.parse" };
  const parsedRouting = routing ? v.safeParse(LineRoutingSchema, routing) : undefined;
  if (parsedRouting && !parsedRouting.success) {
    return {
      outcome: "discarded",
      stage: "routing.validate",
      resultCode: "INVALID_LINE_ROUTING",
    };
  }
  const routedIntents = parsedRouting?.success
    ? new Map(parsedRouting.output.lineTextEvents.map(({ eventId, intent }) => [eventId, intent]))
    : undefined;

  for (const event of events) {
    const providerAccountId = event.source?.userId;
    if (event.type === "follow") {
      await ensureAccountIdentity(db, providerAccountId, workerConfig);
      result = mergeResult(result, { outcome: "succeeded", stage: "account.resolve" });
      continue;
    }
    if (
      event.type !== "message" ||
      !event.message ||
      event.source?.type !== "user" ||
      !providerAccountId
    ) {
      continue;
    }

    const textMessage = event.message.type === "text" ? event.message : null;
    const isTextMessage = textMessage !== null;
    const isLineImageMessage =
      event.message.type === "image" && event.message.contentProvider?.type === "line";
    if (!isTextMessage && !isLineImageMessage) continue;

    const eventId = getLineEventId(event);
    if (!eventId) {
      result = mergeResult(result, {
        outcome: "degraded",
        stage: "routing.validate",
        resultCode: "LINE_EVENT_ID_MISSING",
      });
      continue;
    }

    const intent = textMessage ? classifyLineText(textMessage.text) : undefined;
    if (isTextMessage && routedIntents && routedIntents.get(eventId) !== intent) {
      result = mergeResult(result, {
        outcome: "discarded",
        stage: "routing.validate",
        resultCode: "LINE_ROUTING_MISMATCH",
      });
      continue;
    }
    const resolved = await ensureAccountIdentity(db, providerAccountId, workerConfig);
    if (!resolved) {
      throw new OperationalError({
        code: "LINE_ACCOUNT_IDENTITY_MISSING",
        category: "validation",
        stage: "account.resolve",
        retryable: false,
      });
    }
    let hasAcceptedTerms: boolean;
    try {
      hasAcceptedTerms = await D1.shared.action.agreement.hasAcceptedCurrentTerms(
        db,
        resolved.account.id,
      );
    } catch (error) {
      throw toOperationalError(error, {
        code: "LINE_TERMS_ACCEPTANCE_CHECK_FAILED",
        category: "dependency",
        stage: "terms.acceptance",
        retryable: true,
        dependency: "d1",
      });
    }
    if (!hasAcceptedTerms) {
      if (!workerConfig.lineChannelAccessToken || !event.replyToken || !workerConfig.liffId) {
        result = mergeResult(result, {
          outcome: "degraded",
          stage: "terms.acceptance",
          resultCode: "LINE_TERMS_REPLY_NOT_CONFIGURED",
        });
        continue;
      }
      const replyOutcome = await replyLineText({
        channelAccessToken: workerConfig.lineChannelAccessToken,
        replyToken: event.replyToken,
        texts: [buildTermsAcceptanceReplyText(workerConfig.liffId)],
      });
      if (replyOutcome === "unknown") {
        throw new OperationalError({
          code: "LINE_TERMS_REPLY_FAILED",
          category: "dependency",
          stage: "terms.acceptance",
          retryable: true,
          dependency: "line",
        });
      }
      if (replyOutcome === "rejected") {
        result = mergeResult(result, {
          outcome: "degraded",
          stage: "terms.acceptance",
          resultCode: "LINE_TERMS_REPLY_REJECTED",
        });
        continue;
      }
      result = mergeResult(result, {
        outcome: "discarded",
        stage: "terms.acceptance",
        resultCode: "LINE_TERMS_ACCEPTANCE_REQUIRED",
      });
      continue;
    }
    if (isLineImageMessage) {
      if (!workerConfig.photoDiaryStorageEnabled) {
        result = mergeResult(result, {
          outcome: "discarded",
          stage: "photo.feature-gate",
          resultCode: "PHOTO_DIARY_STORAGE_DISABLED",
        });
        continue;
      }
      if (!cloudflareBindings) {
        throw new OperationalError({
          code: "PHOTO_DIARY_BINDINGS_MISSING",
          category: "configuration",
          stage: "photo.configure",
          retryable: true,
        });
      }
      const photoResult = await processPhotoDiaryImage(
        {
          webhookEventId: event.webhookEventId,
          timestamp: event.timestamp,
          ...(event.replyToken ? { replyToken: event.replyToken } : {}),
          source: { type: "user", userId: providerAccountId },
          message: {
            id: event.message.id,
            type: "image",
            contentProvider: { type: "line" },
          },
        },
        resolved.account.id,
        cloudflareBindings,
        workerConfig,
        isFinalAttempt,
      );
      result = mergeResult(result, {
        outcome:
          photoResult === "stored" || photoResult === "duplicate" ? "succeeded" : "discarded",
        stage: "photo.store",
        ...(photoResult === "stored"
          ? {}
          : { resultCode: `PHOTO_${photoResult.toUpperCase().replaceAll("-", "_")}` }),
      });
      continue;
    }
    if (!textMessage || intent === undefined) continue;
    if (intent === "diagnosis-request") {
      if (!workerConfig.lineChannelAccessToken || !event.replyToken) {
        result = mergeResult(result, {
          outcome: "degraded",
          stage: "line.reply",
          resultCode: "LINE_DIAGNOSIS_REPLY_NOT_CONFIGURED",
        });
        continue;
      }
      const replyOutcome = await replyLineText({
        channelAccessToken: workerConfig.lineChannelAccessToken,
        replyToken: event.replyToken,
        texts: [buildDiagnosisReplyText(workerConfig.liffId)],
      });
      if (replyOutcome === "unknown") {
        throw new OperationalError({
          code: "LINE_DIAGNOSIS_REPLY_FAILED",
          category: "dependency",
          stage: "line.reply",
          retryable: true,
          dependency: "line",
        });
      }
      if (replyOutcome === "rejected") {
        result = mergeResult(result, {
          outcome: "degraded",
          stage: "line.reply",
          resultCode: "LINE_DIAGNOSIS_REPLY_REJECTED",
        });
        continue;
      }
      result = mergeResult(result, { outcome: "succeeded", stage: "line.reply" });
      continue;
    }

    const receivedAt = new Date(event.timestamp);
    const dailyPromptControl = line.text.classifyDailyPromptControl(textMessage.text);
    if (!accountDataNamespace) {
      throw new OperationalError({
        code: "ACCOUNT_DATA_BINDING_MISSING",
        category: "configuration",
        stage: "source.store",
        retryable: true,
        dependency: "account-data",
      });
    }
    const coordinator = coordinatorNamespace?.getByName(resolved.account.id);
    let resetEpoch: number | undefined;
    if (coordinator) {
      try {
        resetEpoch = await coordinator.getResetEpoch(resolved.account.id);
      } catch (error) {
        throw toOperationalError(error, {
          code: "CONVERSATION_COORDINATOR_EPOCH_FAILED",
          category: "dependency",
          stage: "chat.epoch",
          retryable: true,
          dependency: "conversation-coordinator",
        });
      }
    }
    let source: { sourceRecordId: string };
    try {
      source = await accountDataFor(accountDataNamespace, resolved.account.id).execute(
        "conversation.storeLineTextSource",
        {
          eventId,
          body: textMessage.text,
          receivedAt,
          ...(dailyPromptControl ? { dailyPromptControl } : {}),
          ...(resetEpoch === undefined ? {} : { resetEpoch }),
        },
      );
    } catch (error) {
      throw toOperationalError(error, {
        code: "LINE_SOURCE_STORE_FAILED",
        category: "dependency",
        stage: "source.store",
        retryable: true,
        dependency: "account-data",
      });
    }
    if (!coordinatorNamespace) {
      result = mergeResult(result, {
        outcome: "degraded",
        stage: "source.store",
        resultCode: "CHAT_NOT_CONFIGURED",
      });
      continue;
    }

    if (!coordinator || resetEpoch === undefined) {
      throw new OperationalError({
        code: "CONVERSATION_COORDINATOR_EPOCH_MISSING",
        category: "invariant",
        stage: "chat.epoch",
        retryable: true,
        dependency: "conversation-coordinator",
      });
    }
    try {
      await coordinator.acceptMessage({
        accountId: resolved.account.id,
        resetEpoch,
        sourceRecordId: source.sourceRecordId,
        eventId,
        receivedAt: receivedAt.toISOString(),
        ...(traceId ? { traceId } : {}),
        ...(event.replyToken ? { replyToken: event.replyToken } : {}),
      });
    } catch (error) {
      throw toOperationalError(error, {
        code: "CONVERSATION_COORDINATOR_ACCEPT_FAILED",
        category: "dependency",
        stage: "chat.accept",
        retryable: true,
        dependency: "conversation-coordinator",
      });
    }
    result = mergeResult(result, { outcome: "succeeded", stage: "chat.accept" });
  }
  return result;
}

async function ensureAccountIdentity(
  db: D1.shared.Client,
  providerAccountId: string | undefined,
  workerConfig: WorkerConfig,
): Promise<
  Awaited<ReturnType<typeof D1.shared.action.account.resolveAccountByLineMessagingApi>> | undefined
> {
  if (!providerAccountId) return undefined;
  try {
    return await D1.shared.action.account.resolveAccountByLineMessagingApi(
      db,
      providerAccountId,
      resolveLineAccountRole(providerAccountId, workerConfig.adminLineUserIds),
    );
  } catch (error) {
    throw toOperationalError(error, {
      code: "LINE_ACCOUNT_RESOLUTION_FAILED",
      category: "dependency",
      stage: "account.resolve",
      retryable: true,
      dependency: "d1",
    });
  }
}
