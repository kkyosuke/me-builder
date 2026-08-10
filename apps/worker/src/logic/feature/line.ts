import { type AccountDataNamespace, accountDataFor, d1, line } from "@me-builder/lib";
import {
  type ConversationCoordinatorNamespace,
  OperationalError,
  type WebhookQueueMessage,
  toOperationalError,
} from "@me-builder/shared";
import * as v from "valibot";
import type { WorkerConfig } from "../../config";

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
  db: d1.Client,
  workerConfig: WorkerConfig,
  coordinatorNamespace?: ConversationCoordinatorNamespace,
  accountDataNamespace?: AccountDataNamespace,
  routing?: WebhookQueueMessage["routing"],
  traceId?: string,
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
      event.message.type !== "text" ||
      event.source?.type !== "user" ||
      !providerAccountId
    ) {
      continue;
    }

    const eventId = getLineEventId(event);
    if (!eventId) {
      result = mergeResult(result, {
        outcome: "degraded",
        stage: "routing.validate",
        resultCode: "LINE_EVENT_ID_MISSING",
      });
      continue;
    }

    const intent = classifyLineText(event.message.text);
    if (routedIntents && routedIntents.get(eventId) !== intent) {
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
    if (intent === "diagnosis-request") {
      if (!workerConfig.lineChannelAccessToken || !event.replyToken) {
        result = mergeResult(result, {
          outcome: "degraded",
          stage: "line.reply",
          resultCode: "LINE_DIAGNOSIS_REPLY_NOT_CONFIGURED",
        });
        continue;
      }
      try {
        await line.client.create(workerConfig.lineChannelAccessToken).replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: "text", text: buildDiagnosisReplyText(workerConfig.liffId) }],
        });
      } catch (error) {
        throw toOperationalError(error, {
          code: "LINE_DIAGNOSIS_REPLY_FAILED",
          category: "dependency",
          stage: "line.reply",
          retryable: true,
          dependency: "line",
        });
      }
      result = mergeResult(result, { outcome: "succeeded", stage: "line.reply" });
      continue;
    }

    const receivedAt = new Date(event.timestamp);
    if (!accountDataNamespace) {
      throw new OperationalError({
        code: "ACCOUNT_DATA_BINDING_MISSING",
        category: "configuration",
        stage: "source.store",
        retryable: true,
        dependency: "account-data",
      });
    }
    let source: { sourceRecordId: string };
    try {
      source = await accountDataFor(accountDataNamespace, resolved.account.id).execute(
        "conversation.storeLineTextSource",
        {
          eventId,
          body: event.message.text,
          receivedAt,
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
    if (!workerConfig.chatEnabled || !coordinatorNamespace) {
      result = mergeResult(result, {
        outcome: "degraded",
        stage: "source.store",
        resultCode: "CHAT_NOT_CONFIGURED",
      });
      continue;
    }

    const coordinator = coordinatorNamespace.getByName(resolved.account.id);
    try {
      await coordinator.acceptMessage({
        accountId: resolved.account.id,
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
  db: d1.Client,
  providerAccountId: string | undefined,
  workerConfig: WorkerConfig,
): Promise<Awaited<ReturnType<typeof d1.action.account.upsertIdentity>> | undefined> {
  if (!providerAccountId) return undefined;
  try {
    return await d1.action.account.upsertIdentity(db, {
      provider: "line",
      providerAccountId,
      role: workerConfig.adminLineUserIds.includes(providerAccountId) ? "admin" : "user",
    });
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
