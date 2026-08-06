import { d1 } from "@me-builder/lib";
import type { ChatTurnQueueMessage, Message } from "@me-builder/shared";
import { logger } from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { pushLineText } from "../infrastructure/line-delivery";
import { generateDiaryChatResponse } from "../logic/diary-chat";

export async function processChatTurnMessage(
  message: Message<ChatTurnQueueMessage>,
  cf: CloudflareBindings,
  workerConfig: WorkerConfig,
): Promise<void> {
  const db = cf.d1;
  const context = await d1.action.conversation.getTurnContext(db, message.body.turnId);
  if (!context) {
    logger.warn({ turnId: message.body.turnId }, "Chat turn was not found");
    message.ack();
    return;
  }

  if (!cf.do.conversation) throw new Error("CONVERSATION_COORDINATOR binding is not configured");
  const coordinator = cf.do.conversation.getByName(context.accountId);
  const lease = await coordinator.acquireGeneration(
    message.body.turnId,
    message.body.generationEpoch,
  );
  if (!lease.acquired) {
    if (lease.reason === "busy") message.retry({ delaySeconds: 2 });
    else message.ack();
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("chat turn hard deadline reached"),
    Math.max(1, lease.hardDeadlineAt - Date.now()),
  );
  try {
    await d1.action.conversation.markTurnGenerating(db, message.body.turnId);
    const pendingResponse = await d1.action.conversation.getPendingAssistantResponse(
      db,
      message.body.turnId,
    );
    const response = pendingResponse
      ? {
          reply: pendingResponse.body,
          endSession: pendingResponse.endSession,
        }
      : await generateDiaryChatResponse(context.messages, workerConfig, controller.signal, {
          currentUserMessageIds: context.currentUserMessageIds,
          ...(context.summary ? { summary: context.summary } : {}),
        }).then((generated) => ({
          reply: generated.reply,
          endSession: generated.end_session,
        }));
    if (!pendingResponse) {
      await d1.action.conversation.saveAssistantResponse(db, {
        turnId: message.body.turnId,
        body: response.reply,
        endSession: response.endSession,
      });
    }

    const providerAccountId = await d1.action.account.findLineIdentityByAccountId(
      db,
      context.accountId,
    );
    if (
      !providerAccountId ||
      !workerConfig.lineChannelAccessToken ||
      !workerConfig.chatDeliverySecret
    ) {
      throw new Error("LINE final delivery is not configured");
    }
    const leaseIsActive = await coordinator.isGenerationLeaseActive(
      message.body.turnId,
      message.body.generationEpoch,
      lease.leaseToken,
    );
    if (!leaseIsActive) throw new Error("Generation lease expired before final delivery");
    await pushLineText({
      channelAccessToken: workerConfig.lineChannelAccessToken,
      deliverySecret: workerConfig.chatDeliverySecret,
      to: providerAccountId,
      text: response.reply,
      retryIdentity: `final:${message.body.turnId}`,
    });
    await d1.action.conversation.markTurnDelivered(db, message.body.turnId);
    if (response.endSession) {
      await d1.action.conversation.closeTurnSession(db, message.body.turnId);
    }
    const completed = await coordinator.completeGeneration(
      message.body.turnId,
      message.body.generationEpoch,
      lease.leaseToken,
    );
    message.ack();
    if (!completed) {
      logger.warn(
        { turnId: message.body.turnId },
        "Final delivery succeeded after the generation lease expired",
      );
      return;
    }
    logger.info({ turnId: message.body.turnId }, "Diary chat response delivered");
  } catch (error) {
    if (message.attempts >= 2 || controller.signal.aborted) {
      let failureNoticeDelivered = false;
      const providerAccountId = await d1.action.account.findLineIdentityByAccountId(
        db,
        context.accountId,
      );
      if (
        providerAccountId &&
        workerConfig.lineChannelAccessToken &&
        workerConfig.chatDeliverySecret
      ) {
        try {
          await pushLineText({
            channelAccessToken: workerConfig.lineChannelAccessToken,
            deliverySecret: workerConfig.chatDeliverySecret,
            to: providerAccountId,
            text: "うまく返事をまとめられませんでした。書いてくれた内容は受け取っています。時間をおいて、また話しかけてください。",
            retryIdentity: `failure:${message.body.turnId}`,
          });
          failureNoticeDelivered = true;
        } catch {
          failureNoticeDelivered = false;
        }
      }
      if (failureNoticeDelivered) {
        await d1.action.conversation.markTurnFailed(
          db,
          message.body.turnId,
          "generation_or_delivery",
        );
        await coordinator.failGeneration(
          message.body.turnId,
          message.body.generationEpoch,
          lease.leaseToken,
        );
        message.ack();
        return;
      }
    }
    await coordinator.releaseGeneration(
      message.body.turnId,
      message.body.generationEpoch,
      lease.leaseToken,
    );
    logger.error(
      {
        turnId: message.body.turnId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Diary chat turn failed",
    );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
