import { d1 } from "@me-builder/lib";
import type { ChatTurnQueueMessage, Message } from "@me-builder/shared";
import { logger } from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { generateDiaryChatResponse } from "../logic/diary-chat";

/** wrangler.tomlのmax_retriesと揃える。これを超えるとDLQへ落ちるため、その前に引き取る。 */
const MAX_BUSY_ATTEMPTS = 5;
/** 先行Turnのlease(90秒)を待てるだけの間隔にする。2秒刻みではlease中に使い切ってしまう。 */
const BUSY_RETRY_DELAY_SECONDS = 20;

export async function processChatTurnMessage(
  message: Message<ChatTurnQueueMessage>,
  cf: CloudflareBindings,
  workerConfig: WorkerConfig,
): Promise<void> {
  const db = cf.d1;
  const context = await d1.action.conversation.getTurnContext(
    db,
    message.body.turnId,
    workerConfig.chatContextMessageLimit,
  );
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
    if (lease.reason !== "busy") {
      message.ack();
      return;
    }
    if (message.attempts < MAX_BUSY_ATTEMPTS) {
      message.retry({ delaySeconds: BUSY_RETRY_DELAY_SECONDS });
      return;
    }
    // 先行Turnの生成は最大90秒かかる。retryを使い切ってもDLQへ落とさず、
    // Coordinatorへ差し戻して先行Turnの完了後にalarmから再投入させる。
    await coordinator.requeueTurn(message.body.turnId, message.body.generationEpoch);
    logger.warn(
      { turnId: message.body.turnId },
      "Chat turn was requeued after waiting for a lease",
    );
    message.ack();
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("chat turn hard deadline reached"),
    Math.max(1, lease.hardDeadlineAt - Date.now()),
  );
  let failureDeliveryAttempted = false;
  const settleFailureDelivery = async (): Promise<boolean> => {
    const failureDelivery = await coordinator.deliverTurn({
      turnId: message.body.turnId,
      generationEpoch: message.body.generationEpoch,
      leaseToken: lease.leaseToken,
      kind: "failure",
      text: "うまく返事をまとめられませんでした。書いてくれた内容は受け取っています。時間をおいて、また話しかけてください。",
    });
    if (failureDelivery.status === "delivered") {
      if (
        !(await d1.action.conversation.markTurnFailed(
          db,
          message.body.turnId,
          "generation_or_delivery",
        ))
      ) {
        throw new Error("Failed LINE notice could not be reflected in D1");
      }
    } else if (failureDelivery.status === "permanent_failure") {
      await d1.action.conversation.markTurnFailed(db, message.body.turnId, "failure_delivery");
    } else {
      return false;
    }
    await coordinator.failGeneration(
      message.body.turnId,
      message.body.generationEpoch,
      lease.leaseToken,
    );
    message.ack();
    return true;
  };
  try {
    const pendingResponse = await d1.action.conversation.getPendingAssistantResponse(db, {
      accountId: context.accountId,
      turnId: message.body.turnId,
    });
    if (
      !pendingResponse &&
      !(await d1.action.conversation.markTurnGenerating(db, message.body.turnId))
    ) {
      const turnStatus = await d1.action.conversation.getTurnStatus(db, message.body.turnId);
      if (turnStatus === "delivered") {
        await coordinator.completeGeneration(
          message.body.turnId,
          message.body.generationEpoch,
          lease.leaseToken,
        );
      } else {
        await coordinator.failGeneration(
          message.body.turnId,
          message.body.generationEpoch,
          lease.leaseToken,
        );
      }
      message.ack();
      return;
    }
    if (!(await d1.action.conversation.isTurnSessionActive(db, message.body.turnId))) {
      await d1.action.conversation.markTurnFailed(db, message.body.turnId, "closed_session");
      await coordinator.failGeneration(
        message.body.turnId,
        message.body.generationEpoch,
        lease.leaseToken,
      );
      message.ack();
      return;
    }
    if (!pendingResponse && message.attempts > 2) {
      failureDeliveryAttempted = true;
      if (await settleFailureDelivery()) return;
      throw new Error("Failure delivery could not be settled");
    }
    const response = pendingResponse
      ? {
          reply: pendingResponse.body,
          endSession: pendingResponse.endSession,
        }
      : await generateDiaryChatResponse(context.messages, workerConfig, controller.signal, {
          currentUserMessageIds: context.currentUserMessageIds,
        }).then((generated) => ({
          reply: generated.reply,
          endSession: generated.end_session,
        }));
    if (!pendingResponse) {
      const leaseIsActive = await coordinator.isGenerationLeaseActive(
        message.body.turnId,
        message.body.generationEpoch,
        lease.leaseToken,
      );
      if (!leaseIsActive) throw new Error("Generation lease expired before response persistence");
      await d1.action.conversation.saveAssistantResponse(db, {
        turnId: message.body.turnId,
        body: response.reply,
        endSession: response.endSession,
      });
    }
    if (!(await d1.action.conversation.isTurnSessionActive(db, message.body.turnId))) {
      await d1.action.conversation.markTurnFailed(db, message.body.turnId, "closed_session");
      await coordinator.failGeneration(
        message.body.turnId,
        message.body.generationEpoch,
        lease.leaseToken,
      );
      message.ack();
      return;
    }

    const delivery = await coordinator.deliverTurn({
      turnId: message.body.turnId,
      generationEpoch: message.body.generationEpoch,
      leaseToken: lease.leaseToken,
      kind: "final",
      text: response.reply,
    });
    if (delivery.status === "lease_expired") {
      throw new Error("Generation lease expired before final delivery was reserved");
    }
    if (delivery.status === "superseded" || delivery.status === "permanent_failure") {
      await d1.action.conversation.markTurnFailed(db, message.body.turnId, "final_delivery");
      await coordinator.failGeneration(
        message.body.turnId,
        message.body.generationEpoch,
        lease.leaseToken,
      );
      message.ack();
      return;
    }
    if (!(await d1.action.conversation.markTurnDelivered(db, message.body.turnId))) {
      throw new Error("Delivered LINE response could not be reflected in D1");
    }
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
    if ((message.attempts >= 2 || controller.signal.aborted) && !failureDeliveryAttempted) {
      try {
        failureDeliveryAttempted = true;
        if (await settleFailureDelivery()) return;
      } catch {
        // 一時的な配送失敗は下でleaseを解放し、Queueへ同じoutboxを再配送させる。
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
