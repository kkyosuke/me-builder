import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import { d1, line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { WorkerConfig } from "../../config";
import type { ConversationCoordinator } from "../../conversation-coordinator";
import { pushLineText } from "../../infrastructure/line-delivery";

export const classifyLineText = line.text.classify;

function buildDiagnosisLink(liffId: string): string {
  return `今日の診断に答える\nhttps://liff.line.me/${liffId}`;
}

/** 日記の初回応答。AIのfinalは別のChat Turn Queueから送る。 */
export function buildReplyText(messageText: string, liffId?: string): string {
  if (classifyLineText(messageText) === "diagnosis-request") {
    return liffId
      ? buildDiagnosisLink(liffId)
      : "いまは診断のリンクをお渡しできません。時間をおいてもう一度お試しください。";
  }
  const received = "受け付けました。少し考えてから返事をするね。";
  return liffId ? `${received}\n${buildDiagnosisLink(liffId)}` : received;
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
  coordinatorNamespace?: DurableObjectNamespace<ConversationCoordinator>,
): Promise<void> {
  const events = line.webhook.parseEvents(payload);

  for (const event of events) {
    const providerAccountId = event.source?.userId;
    if (event.type === "follow") {
      await ensureAccountIdentity(db, providerAccountId, "follow");
      continue;
    }
    if (event.type !== "message" || event.message.type !== "text" || !providerAccountId) continue;

    const resolved = await ensureAccountIdentity(db, providerAccountId, "message");
    if (!resolved) throw new Error("LINE account could not be resolved");
    const eventId = getLineEventId(event);
    if (!eventId) {
      logger.warn(
        { intent: classifyLineText(event.message.text) },
        "LINE text event has no stable event ID",
      );
      continue;
    }

    const intent = classifyLineText(event.message.text);
    if (intent === "diagnosis-request") {
      if (!workerConfig.lineChannelAccessToken || !event.replyToken) {
        logger.warn({ intent }, "LINE diagnosis reply is not configured");
        continue;
      }
      await line.client.create(workerConfig.lineChannelAccessToken).replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: "text", text: buildReplyText(event.message.text, workerConfig.liffId) }],
      });
      continue;
    }

    const receivedAt = new Date(event.timestamp);
    const source = await d1.action.conversation.storeLineTextSource(db, {
      accountId: resolved.account.id,
      eventId,
      body: event.message.text,
      receivedAt,
    });
    if (!workerConfig.chatEnabled || !coordinatorNamespace) {
      logger.warn({ reason: "chat_not_configured" }, "Diary saved without AI chat processing");
      await deliverInitialResponse(providerAccountId, eventId, event.message.text, workerConfig);
      continue;
    }

    const coordinator = coordinatorNamespace.getByName(resolved.account.id);
    await coordinator.acceptMessage({
      accountId: resolved.account.id,
      sourceRecordId: source.sourceRecordId,
      eventId,
      receivedAt: receivedAt.toISOString(),
    });
    await deliverInitialResponse(providerAccountId, eventId, event.message.text, workerConfig);
    logger.info({ intent }, "LINE diary source saved and accepted by coordinator");
  }
}

async function deliverInitialResponse(
  providerAccountId: string,
  eventId: string,
  messageText: string,
  workerConfig: WorkerConfig,
): Promise<void> {
  if (!workerConfig.lineChannelAccessToken || !workerConfig.chatDeliverySecret) {
    logger.warn(
      {
        hasChannelAccessToken: Boolean(workerConfig.lineChannelAccessToken),
        hasDeliverySecret: Boolean(workerConfig.chatDeliverySecret),
      },
      "LINE push delivery is not configured",
    );
    return;
  }
  await pushLineText({
    channelAccessToken: workerConfig.lineChannelAccessToken,
    deliverySecret: workerConfig.chatDeliverySecret,
    to: providerAccountId,
    text: buildReplyText(messageText, workerConfig.liffId),
    retryIdentity: `receipt:${eventId}`,
  });
}

async function ensureAccountIdentity(
  db: d1.Client,
  providerAccountId: string | undefined,
  trigger: "follow" | "message",
): Promise<Awaited<ReturnType<typeof d1.action.account.upsertIdentity>> | undefined> {
  if (!providerAccountId) return undefined;
  try {
    const resolved = await d1.action.account.upsertIdentity(db, {
      provider: "line",
      providerAccountId,
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
