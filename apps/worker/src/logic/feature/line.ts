import { type AccountDataNamespace, accountDataFor, d1, line } from "@me-builder/lib";
import {
  type ConversationCoordinatorNamespace,
  type WebhookQueueMessage,
  logger,
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
): Promise<void> {
  const events = line.webhook.parseEvents(payload);
  const parsedRouting = routing ? v.safeParse(LineRoutingSchema, routing) : undefined;
  if (parsedRouting && !parsedRouting.success) {
    logger.warn({ reason: "invalid_line_routing" }, "Rejected invalid LINE command routing");
    return;
  }
  const routedIntents = parsedRouting?.success
    ? new Map(parsedRouting.output.lineTextEvents.map(({ eventId, intent }) => [eventId, intent]))
    : undefined;

  for (const event of events) {
    const providerAccountId = event.source?.userId;
    if (event.type === "follow") {
      await ensureAccountIdentity(db, providerAccountId, "follow", workerConfig);
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
      logger.warn(
        { intent: classifyLineText(event.message.text) },
        "LINE text event has no stable event ID",
      );
      continue;
    }

    const intent = classifyLineText(event.message.text);
    if (routedIntents && routedIntents.get(eventId) !== intent) {
      logger.warn({ intent }, "Rejected LINE event with inconsistent command routing");
      continue;
    }
    const resolved = await ensureAccountIdentity(db, providerAccountId, "message", workerConfig);
    if (!resolved) throw new Error("LINE account could not be resolved");
    if (intent === "diagnosis-request") {
      if (!workerConfig.lineChannelAccessToken || !event.replyToken) {
        logger.warn({ intent }, "LINE diagnosis reply is not configured");
        continue;
      }
      await line.client.create(workerConfig.lineChannelAccessToken).replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: "text", text: buildDiagnosisReplyText(workerConfig.liffId) }],
      });
      continue;
    }

    const receivedAt = new Date(event.timestamp);
    if (!accountDataNamespace) throw new Error("ACCOUNT_DATA binding is not configured");
    const source = await accountDataFor(accountDataNamespace, resolved.account.id).execute(
      "conversation.storeLineTextSource",
      {
        accountId: resolved.account.id,
        eventId,
        body: event.message.text,
        receivedAt,
      },
    );
    if (!workerConfig.chatEnabled || !coordinatorNamespace) {
      logger.warn({ reason: "chat_not_configured" }, "Diary saved without AI chat processing");
      continue;
    }

    const coordinator = coordinatorNamespace.getByName(resolved.account.id);
    await coordinator.acceptMessage({
      accountId: resolved.account.id,
      sourceRecordId: source.sourceRecordId,
      eventId,
      receivedAt: receivedAt.toISOString(),
      ...(event.replyToken ? { replyToken: event.replyToken } : {}),
    });
    logger.info({ intent }, "LINE diary source saved and accepted by coordinator");
  }
}

async function ensureAccountIdentity(
  db: d1.Client,
  providerAccountId: string | undefined,
  trigger: "follow" | "message",
  workerConfig: WorkerConfig,
): Promise<Awaited<ReturnType<typeof d1.action.account.upsertIdentity>> | undefined> {
  if (!providerAccountId) return undefined;
  try {
    const resolved = await d1.action.account.upsertIdentity(db, {
      provider: "line",
      providerAccountId,
      role: workerConfig.adminLineUserIds.includes(providerAccountId) ? "admin" : "user",
    });
    logger.info({ trigger }, "LINE Account identity ensured");
    return resolved;
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError", trigger },
      "Failed to ensure LINE Account identity",
    );
    return undefined;
  }
}
