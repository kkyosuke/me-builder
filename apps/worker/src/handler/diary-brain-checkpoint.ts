import { accountDataFor, d1 } from "@me-builder/lib";
import type { DiaryBrainCheckpointQueueMessage, Message } from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { createLineRetryKey, pushLineTextWithRetryKey } from "../infrastructure/line-delivery";
import {
  DIARY_BRAIN_PROMPT_VERSION,
  buildDevelopmentBrainItemMessage,
  generateDiaryBrainCandidates,
} from "../logic/diary-brain";

export async function processDiaryBrainCheckpointMessage(
  message: Message<DiaryBrainCheckpointQueueMessage>,
  cf: CloudflareBindings,
  workerConfig: WorkerConfig,
): Promise<void> {
  if (!cf.do.accountData) throw new Error("ACCOUNT_DATA binding is not configured");
  const accountData = accountDataFor(cf.do.accountData, message.body.accountId);
  const context = await accountData.execute(
    "conversation.getDiaryBrainCheckpointContext",
    message.body.checkpointId,
  );
  if (!context) {
    await sendDevelopmentNotification(
      accountData,
      message.body.accountId,
      message.body.checkpointId,
      cf,
      workerConfig,
    );
    message.ack();
    return;
  }
  const candidates = await generateDiaryBrainCandidates(
    context.messages,
    context.sourceMessageIds,
    workerConfig,
  );
  if (!candidates) {
    throw new Error("Diary Brain candidate generation failed");
  }
  const applied = await accountData.execute(
    "conversation.applyDiaryBrainCheckpoint",
    context.checkpointId,
    context.throughSequence,
    DIARY_BRAIN_PROMPT_VERSION,
    candidates.map((candidate) => ({
      statement: candidate.statement,
      sourceMessageIds: candidate.source_message_ids,
    })),
  );
  if (!applied) {
    message.ack();
    return;
  }

  await sendDevelopmentNotification(
    accountData,
    message.body.accountId,
    context.checkpointId,
    cf,
    workerConfig,
    applied,
  );
  message.ack();
}

async function sendDevelopmentNotification(
  accountData: ReturnType<typeof accountDataFor>,
  accountId: string,
  checkpointId: string,
  cf: CloudflareBindings,
  workerConfig: WorkerConfig,
  appliedResult?: {
    candidates: readonly { statement: string; sourceMessageIds: readonly string[] }[];
  },
): Promise<void> {
  const result =
    appliedResult ??
    (await accountData.execute(
      "conversation.getDiaryBrainCheckpointDevelopmentNotification",
      checkpointId,
    ));
  if (!result) return;
  const developmentMessage = buildDevelopmentBrainItemMessage(
    result.candidates,
    workerConfig.environment,
  );
  if (
    developmentMessage &&
    workerConfig.lineChannelAccessToken &&
    workerConfig.chatDeliverySecret
  ) {
    const providerAccountId = await d1.action.account.findLineIdentityByAccountId(cf.d1, accountId);
    if (providerAccountId) {
      await pushLineTextWithRetryKey({
        channelAccessToken: workerConfig.lineChannelAccessToken,
        to: providerAccountId,
        text: developmentMessage,
        retryKey: await createLineRetryKey(
          workerConfig.chatDeliverySecret,
          `diary-brain:${checkpointId}`,
        ),
      });
      await accountData.execute(
        "conversation.markDiaryBrainCheckpointDevelopmentNotificationSent",
        checkpointId,
      );
    }
  }
}
