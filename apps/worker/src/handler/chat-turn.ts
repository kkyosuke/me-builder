import { accountDataFor, billing, buildPromptContextCollectionCandidates } from "@me-builder/lib";
import {
  type ChatTurnQueueMessage,
  type ConversationCoordinatorRpc,
  type GenerationLease,
  MAX_CHAT_TURN_TRACE_IDS,
  type Message,
  OperationalError,
  type OperationalErrorDescriptor,
  type OperationalOutcome,
  type TurnDeliveryResult,
  describeQueueMessageResult,
  logger,
  operationalLogLevel,
  toOperationalError,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { createGeminiUsageRecorder } from "../infrastructure/gemini-usage";
import { loadBrainContextMemories } from "../logic/brain-context";
import {
  buildDevelopmentBrainUsageMessage,
  classifySafety,
  generateDiaryChatResponse,
} from "../logic/diary-chat";
import {
  buildRelationshipQuestionPlan,
  selectFullRelationshipHistory,
} from "../logic/relationship-question";
import { shouldLoadSelfCareContext } from "../logic/self-care-context";
import {
  DEFAULT_DIARY_CHAT_PROMPT_OPTIONS,
  getDiaryChatConversationGuidance,
} from "../prompt/diary-chat";

/** wrangler.tomlのmax_retries=5に初回配送を加えた最大試行回数。 */
export const CHAT_TURN_MAX_ATTEMPTS = 6;
/** wrangler.tomlのmax_retriesと揃える。これを超えるとDLQへ落ちるため、その前に引き取る。 */
const MAX_BUSY_ATTEMPTS = 5;
/** 先行Turnのlease(90秒)を待てるだけの間隔にする。2秒刻みではlease中に使い切ってしまう。 */
const BUSY_RETRY_DELAY_SECONDS = 20;

type TerminalDisposition = "ack" | "retry" | "dead-letter";
type TerminalDetails = {
  outcome: OperationalOutcome;
  disposition: TerminalDisposition;
  stage: string;
  resultCode?: string;
  error?: unknown;
};

function createTraceFields(message: Message<ChatTurnQueueMessage>) {
  const providedTraceIds = message.body.traceIds ?? [];
  const traceId = message.body.traceId ?? providedTraceIds.at(-1) ?? message.id;
  const allTraceIds = [...new Set([...providedTraceIds, traceId])];
  const traceIds = allTraceIds.slice(-MAX_CHAT_TURN_TRACE_IDS);
  return {
    traceId,
    traceIds,
    ...(allTraceIds.length > traceIds.length
      ? { traceIdCount: allTraceIds.length, traceIdsTruncated: true }
      : {}),
  };
}

function logTerminal(
  message: Message<ChatTurnQueueMessage>,
  workerConfig: WorkerConfig,
  startedAt: number,
  traceFields: ReturnType<typeof createTraceFields>,
  details: TerminalDetails,
): void {
  const durationMs = Date.now() - startedAt;
  const safeError = details.error
    ? toSafeOperationalErrorFields(details.error, {
        code: "UNEXPECTED_CHAT_TURN_ERROR",
        category: "unknown",
        stage: details.stage,
        retryable: true,
      })
    : undefined;
  const fields = {
    event:
      details.error || details.outcome === "failed"
        ? "queue.message.failed"
        : "queue.message.completed",
    service: "worker",
    environment: workerConfig.environment,
    component: "chat-turn",
    ...traceFields,
    queueMessageId: message.id,
    messageType: "chat-turn",
    attempt: message.attempts,
    outcome: details.outcome,
    disposition: details.disposition,
    stage: details.stage,
    ...(details.resultCode ? { resultCode: details.resultCode } : {}),
    ...(safeError ?? {}),
    durationMs,
  };
  const description = describeQueueMessageResult({
    flow: "chat-turn",
    outcome: details.outcome,
    disposition: details.disposition,
    // 例外があるときは、結果を確定させた工程ではなく失敗した工程をfieldsと揃えて示す。
    stage: safeError?.stage ?? details.stage,
    attempt: message.attempts,
    maxAttempts: CHAT_TURN_MAX_ATTEMPTS,
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

function invariantError(descriptor: OperationalErrorDescriptor): OperationalError {
  return new OperationalError(descriptor);
}

export async function processChatTurnMessage(
  message: Message<ChatTurnQueueMessage>,
  cf: CloudflareBindings,
  workerConfig: WorkerConfig,
): Promise<void> {
  const startedAt = Date.now();
  const traceFields = createTraceFields(message);
  let coordinator: ConversationCoordinatorRpc | undefined;
  let accountData: ReturnType<typeof accountDataFor> | undefined;
  let lease: { acquired: true; leaseToken: string; hardDeadlineAt: number } | undefined;
  let controller: AbortController | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let failureDeliveryAttempted = false;
  let aiUsageReserved = false;
  let settleFailureDelivery:
    | (() => Promise<"failure-notice-delivered" | "failure-notice-permanent-failure" | undefined>)
    | undefined;

  try {
    if (!cf.do.accountData) {
      throw invariantError({
        code: "ACCOUNT_DATA_BINDING_MISSING",
        category: "configuration",
        stage: "context.load",
        retryable: true,
        dependency: "account-data",
      });
    }
    const accountDataClient = accountDataFor(cf.do.accountData, message.body.accountId);
    accountData = accountDataClient;
    const context = await atBoundary(
      () =>
        accountDataClient.execute(
          "conversation.getTurnContext",
          message.body.turnId,
          workerConfig.chatContextMessageLimit,
        ),
      {
        code: "CHAT_TURN_CONTEXT_LOAD_FAILED",
        category: "dependency",
        stage: "context.load",
        retryable: true,
        dependency: "account-data",
      },
    );
    if (!context) {
      message.ack();
      logTerminal(message, workerConfig, startedAt, traceFields, {
        outcome: "discarded",
        disposition: "ack",
        stage: "context.load",
        resultCode: "CHAT_TURN_NOT_FOUND",
      });
      return;
    }

    if (!cf.do.conversation) {
      throw invariantError({
        code: "CONVERSATION_COORDINATOR_BINDING_MISSING",
        category: "configuration",
        stage: "generation.acquire",
        retryable: true,
        dependency: "conversation-coordinator",
      });
    }
    if (context.accountId !== message.body.accountId) {
      throw invariantError({
        code: "CHAT_TURN_ACCOUNT_MISMATCH",
        category: "invariant",
        stage: "context.validate",
        retryable: false,
      });
    }
    const coordinatorClient = cf.do.conversation.getByName(
      message.body.accountId,
    ) as unknown as ConversationCoordinatorRpc;
    coordinator = coordinatorClient;
    const acquired = await atBoundary<GenerationLease>(
      () => coordinatorClient.acquireGeneration(message.body.turnId, message.body.generationEpoch),
      {
        code: "GENERATION_LEASE_ACQUIRE_FAILED",
        category: "dependency",
        stage: "generation.acquire",
        retryable: true,
        dependency: "conversation-coordinator",
      },
    );
    if (!acquired.acquired) {
      if (acquired.reason !== "busy") {
        message.ack();
        logTerminal(message, workerConfig, startedAt, traceFields, {
          outcome: "discarded",
          disposition: "ack",
          stage: "generation.acquire",
          resultCode:
            acquired.reason === "completed" ? "CHAT_TURN_ALREADY_COMPLETED" : "CHAT_TURN_STALE",
        });
        return;
      }
      if (message.attempts < MAX_BUSY_ATTEMPTS) {
        message.retry({ delaySeconds: BUSY_RETRY_DELAY_SECONDS });
        logTerminal(message, workerConfig, startedAt, traceFields, {
          outcome: "deferred",
          disposition: "retry",
          stage: "generation.acquire",
          resultCode: "GENERATION_LEASE_BUSY",
        });
        return;
      }
      await atBoundary(
        () => coordinatorClient.requeueTurn(message.body.turnId, message.body.generationEpoch),
        {
          code: "CHAT_TURN_REQUEUE_FAILED",
          category: "dependency",
          stage: "generation.requeue",
          retryable: true,
          dependency: "conversation-coordinator",
        },
      );
      message.ack();
      logTerminal(message, workerConfig, startedAt, traceFields, {
        outcome: "deferred",
        disposition: "ack",
        stage: "generation.requeue",
        resultCode: "CHAT_TURN_REQUEUED_AFTER_BUSY",
      });
      return;
    }
    lease = acquired;

    controller = new AbortController();
    timeout = setTimeout(
      () => controller?.abort("chat turn hard deadline reached"),
      Math.max(1, lease.hardDeadlineAt - Date.now()),
    );

    settleFailureDelivery = async () => {
      const failureDelivery = await atBoundary<TurnDeliveryResult>(
        () =>
          coordinatorClient.deliverTurn({
            turnId: message.body.turnId,
            generationEpoch: message.body.generationEpoch,
            leaseToken: lease?.leaseToken ?? "",
            kind: "failure",
            text: "うまく返事をまとめられませんでした。書いてくれた内容は受け取っています。時間をおいて、また話しかけてください。",
          }),
        {
          code: "FAILURE_NOTICE_DELIVERY_FAILED",
          category: "dependency",
          stage: "line.failure-deliver",
          retryable: true,
          dependency: "line",
        },
      );
      if (failureDelivery.status === "delivered") {
        const marked = await atBoundary(
          () =>
            accountDataClient.execute(
              "conversation.markTurnFailed",
              message.body.turnId,
              "generation_or_delivery",
            ),
          {
            code: "FAILURE_NOTICE_STATE_UPDATE_FAILED",
            category: "dependency",
            stage: "turn.fail",
            retryable: true,
            dependency: "account-data",
          },
        );
        if (!marked) {
          throw invariantError({
            code: "FAILURE_NOTICE_STATE_NOT_UPDATED",
            category: "invariant",
            stage: "turn.fail",
            retryable: true,
          });
        }
      } else if (failureDelivery.status === "permanent_failure") {
        await atBoundary(
          () =>
            accountDataClient.execute(
              "conversation.markTurnFailed",
              message.body.turnId,
              "failure_delivery",
            ),
          {
            code: "FAILURE_DELIVERY_STATE_UPDATE_FAILED",
            category: "dependency",
            stage: "turn.fail",
            retryable: true,
            dependency: "account-data",
          },
        );
      } else {
        return undefined;
      }
      await atBoundary(
        () =>
          coordinatorClient.failGeneration(
            message.body.turnId,
            message.body.generationEpoch,
            lease?.leaseToken ?? "",
          ),
        {
          code: "GENERATION_FAILURE_FINALIZE_FAILED",
          category: "dependency",
          stage: "generation.fail",
          retryable: true,
          dependency: "conversation-coordinator",
        },
      );
      if (aiUsageReserved) {
        await accountDataClient.execute("aiUsage.release", message.body.turnId);
        aiUsageReserved = false;
      }
      return failureDelivery.status === "delivered"
        ? "failure-notice-delivered"
        : "failure-notice-permanent-failure";
    };

    const pendingResponse = await atBoundary(
      () =>
        accountDataClient.execute("conversation.getPendingAssistantResponse", message.body.turnId),
      {
        code: "PENDING_RESPONSE_LOAD_FAILED",
        category: "dependency",
        stage: "response.load",
        retryable: true,
        dependency: "account-data",
      },
    );
    if (
      !pendingResponse &&
      !(await atBoundary(
        () => accountDataClient.execute("conversation.markTurnGenerating", message.body.turnId),
        {
          code: "TURN_GENERATING_STATE_UPDATE_FAILED",
          category: "dependency",
          stage: "generation.start",
          retryable: true,
          dependency: "account-data",
        },
      ))
    ) {
      const turnStatus = await atBoundary(
        () => accountDataClient.execute("conversation.getTurnStatus", message.body.turnId),
        {
          code: "TURN_STATUS_LOAD_FAILED",
          category: "dependency",
          stage: "turn.status",
          retryable: true,
          dependency: "account-data",
        },
      );
      await atBoundary(
        () =>
          accountDataClient.execute(
            turnStatus === "delivered" ? "aiUsage.commit" : "aiUsage.release",
            message.body.turnId,
          ),
        {
          code:
            turnStatus === "delivered"
              ? "AI_REPLY_USAGE_COMMIT_FAILED"
              : "AI_REPLY_USAGE_RELEASE_FAILED",
          category: "dependency",
          stage: "entitlement.settle",
          retryable: true,
          dependency: "account-data",
        },
      );
      if (turnStatus === "delivered") {
        await atBoundary(
          () =>
            coordinatorClient.completeGeneration(
              message.body.turnId,
              message.body.generationEpoch,
              lease?.leaseToken ?? "",
            ),
          {
            code: "GENERATION_COMPLETE_FAILED",
            category: "dependency",
            stage: "generation.complete",
            retryable: true,
            dependency: "conversation-coordinator",
          },
        );
      } else {
        await atBoundary(
          () =>
            coordinatorClient.failGeneration(
              message.body.turnId,
              message.body.generationEpoch,
              lease?.leaseToken ?? "",
            ),
          {
            code: "GENERATION_FAILURE_FINALIZE_FAILED",
            category: "dependency",
            stage: "generation.fail",
            retryable: true,
            dependency: "conversation-coordinator",
          },
        );
      }
      message.ack();
      logTerminal(message, workerConfig, startedAt, traceFields, {
        outcome: turnStatus === "delivered" ? "succeeded" : "discarded",
        disposition: "ack",
        stage: "turn.status",
        resultCode:
          turnStatus === "delivered" ? "CHAT_TURN_ALREADY_DELIVERED" : "TURN_NOT_GENERATABLE",
      });
      return;
    }

    const sessionActive = async () =>
      atBoundary(
        () => accountDataClient.execute("conversation.isTurnSessionActive", message.body.turnId),
        {
          code: "SESSION_STATE_LOAD_FAILED",
          category: "dependency",
          stage: "session.validate",
          retryable: true,
          dependency: "account-data",
        },
      );
    const closeInactiveTurn = async () => {
      await atBoundary(
        () =>
          accountDataClient.execute(
            "conversation.markTurnFailed",
            message.body.turnId,
            "closed_session",
          ),
        {
          code: "CLOSED_SESSION_STATE_UPDATE_FAILED",
          category: "dependency",
          stage: "turn.fail",
          retryable: true,
          dependency: "account-data",
        },
      );
      await atBoundary(
        () =>
          coordinatorClient.failGeneration(
            message.body.turnId,
            message.body.generationEpoch,
            lease?.leaseToken ?? "",
          ),
        {
          code: "GENERATION_FAILURE_FINALIZE_FAILED",
          category: "dependency",
          stage: "generation.fail",
          retryable: true,
          dependency: "conversation-coordinator",
        },
      );
      if (aiUsageReserved) {
        await accountDataClient.execute("aiUsage.release", message.body.turnId);
        aiUsageReserved = false;
      }
      message.ack();
      logTerminal(message, workerConfig, startedAt, traceFields, {
        outcome: "discarded",
        disposition: "ack",
        stage: "session.validate",
        resultCode: "CHAT_SESSION_CLOSED",
      });
    };
    if (!(await sessionActive())) {
      await closeInactiveTurn();
      return;
    }

    if (!pendingResponse && message.attempts > 2) {
      failureDeliveryAttempted = true;
      const settlement = await settleFailureDelivery();
      if (settlement) {
        message.ack();
        logTerminal(message, workerConfig, startedAt, traceFields, {
          outcome: settlement === "failure-notice-delivered" ? "degraded" : "failed",
          disposition: "ack",
          stage: "line.failure-deliver",
          resultCode:
            settlement === "failure-notice-delivered"
              ? "GENERATION_RETRY_BUDGET_EXHAUSTED_FAILURE_NOTICE_DELIVERED"
              : "GENERATION_RETRY_BUDGET_EXHAUSTED_FAILURE_NOTICE_PERMANENT_FAILURE",
        });
        return;
      }
      throw invariantError({
        code: "FAILURE_NOTICE_NOT_SETTLED",
        category: "invariant",
        stage: "line.failure-deliver",
        retryable: true,
      });
    }

    const generationController = controller;
    const safetyRoute = classifySafety(context.messages, context.currentUserMessageIds);
    const entitlement = await new billing.EntitlementService(
      cf.planAssignmentProvider ?? new billing.FamilyAwareAccountPlanAssignmentProvider(cf.d1),
    ).resolve(message.body.accountId);
    const aiReplyPeriod = billing.resolveEntitlementUsagePeriod(entitlement, "ai-reply");
    const relationshipQuestionMode = entitlement.policy.relationshipQuestionContext;
    const initialRelationshipPlan = buildRelationshipQuestionPlan({
      accountId: message.body.accountId,
      mode: relationshipQuestionMode,
      messages: context.messages,
      currentUserMessageIds: context.currentUserMessageIds,
    });
    const aiReplyReservation =
      safetyRoute !== "normal"
        ? undefined
        : await atBoundary(
            () =>
              accountDataClient.execute("aiUsage.reserve", {
                requestId: message.body.turnId,
                kind: "ai-reply",
                period: aiReplyPeriod,
                limit: entitlement.policy.aiReply.limit,
              }),
            {
              code: "AI_REPLY_USAGE_RESERVATION_FAILED",
              category: "dependency",
              stage: "entitlement.reserve",
              retryable: true,
              dependency: "account-data",
            },
          );
    aiUsageReserved =
      aiReplyReservation?.outcome === "reserved" || aiReplyReservation?.outcome === "existing";
    const quotaResponse =
      aiReplyReservation?.outcome === "limit-reached"
        ? {
            reply:
              "今の利用期間のAI返信上限に達しました。書いてくれた内容は保存されています。次の利用期間になると、またAI返信を利用できます。",
            endSession: false,
            dailyPromptFollowUp: undefined,
            collectionTarget: undefined,
            brainUsages: [],
            usedBrainItems: [],
          }
        : undefined;
    const currentUserText = context.messages
      .filter(({ id, role }) => role === "user" && context.currentUserMessageIds.includes(id))
      .map(({ body }) => body)
      .join("\n");
    const [
      loadedBrainMemories,
      relationshipDiagnoses,
      collectedPromptContextKinds,
      goalFollowUp,
      selfCareMemories,
    ] =
      pendingResponse || safetyRoute !== "normal" || quotaResponse
        ? [[], [], [], null, []]
        : await Promise.all([
            initialRelationshipPlan.active && relationshipQuestionMode !== "confirmed-history"
              ? Promise.resolve([])
              : loadBrainContextMemories({
                  cf,
                  workerConfig,
                  accountId: message.body.accountId,
                  messages: context.messages,
                  currentUserMessageIds: context.currentUserMessageIds,
                  semanticSearchDays: entitlement.policy.semanticSearchDays,
                  ...(initialRelationshipPlan.active
                    ? { requiredAccessLabel: "relationship" }
                    : {}),
                  ...(generationController.signal ? { signal: generationController.signal } : {}),
                }),
            initialRelationshipPlan.active && relationshipQuestionMode !== "current-message"
              ? accountDataClient
                  .execute("brain.loadRelationshipDiagnosisContexts")
                  .catch((error: unknown) => {
                    logger.warn(
                      {
                        event: "relationship-question.diagnosis-context.failed",
                        service: "worker",
                        environment: workerConfig.environment,
                        component: "chat-turn",
                        outcome: "degraded",
                        disposition: "continue",
                        ...toSafeOperationalErrorFields(error, {
                          code: "RELATIONSHIP_DIAGNOSIS_CONTEXT_LOAD_FAILED",
                          category: "dependency",
                          stage: "context.relationship-diagnosis",
                          retryable: false,
                          dependency: "account-data",
                        }),
                      },
                      "[Relationship question] failed to load diagnosis context",
                    );
                    return [];
                  })
              : Promise.resolve([]),
            accountDataClient
              .execute("brain.listActivePromptContextKinds")
              .catch((error: unknown) => {
                logger.warn(
                  {
                    event: "prompt-context.collection-state.failed",
                    service: "worker",
                    environment: workerConfig.environment,
                    component: "chat-turn",
                    outcome: "degraded",
                    disposition: "continue",
                    ...toSafeOperationalErrorFields(error, {
                      code: "PROMPT_CONTEXT_COLLECTION_STATE_LOAD_FAILED",
                      category: "dependency",
                      stage: "context.prompt-context",
                      retryable: false,
                      dependency: "account-data",
                    }),
                  },
                  "[Prompt context] failed at context.prompt-context -> continue without collection candidates",
                );
                return undefined;
              }),
            !initialRelationshipPlan.active && entitlement.policy.features["goal-follow-up"]
              ? accountDataClient
                  .execute(
                    "goalFollowUp.selectMemory",
                    entitlement.policy.goalFollowUp,
                    currentUserText,
                  )
                  .catch((error: unknown) => {
                    logger.warn(
                      {
                        event: "goal-follow-up.context.failed",
                        service: "worker",
                        environment: workerConfig.environment,
                        component: "chat-turn",
                        outcome: "degraded",
                        disposition: "continue",
                        ...toSafeOperationalErrorFields(error, {
                          code: "GOAL_FOLLOW_UP_CONTEXT_LOAD_FAILED",
                          category: "dependency",
                          stage: "context.goal-follow-up",
                          retryable: false,
                          dependency: "account-data",
                        }),
                      },
                      "[Goal follow-up] failed to load context",
                    );
                    return null;
                  })
              : Promise.resolve(null),
            !initialRelationshipPlan.active &&
            shouldLoadSelfCareContext({
              mode: entitlement.policy.selfCareContext,
              safetyRoute,
              currentText: currentUserText,
            })
              ? accountDataClient
                  .execute("selfCareContext.selectMemories", entitlement.policy.selfCareContext)
                  .catch((error: unknown) => {
                    logger.warn(
                      {
                        event: "self-care.context.failed",
                        service: "worker",
                        environment: workerConfig.environment,
                        component: "chat-turn",
                        outcome: "degraded",
                        disposition: "continue",
                        ...toSafeOperationalErrorFields(error, {
                          code: "SELF_CARE_CONTEXT_LOAD_FAILED",
                          category: "dependency",
                          stage: "context.self-care",
                          retryable: false,
                          dependency: "account-data",
                        }),
                      },
                      "[Self-care] failed to load confirmed context",
                    );
                    return [];
                  })
              : Promise.resolve([]),
          ]);
    const relationshipPlan = buildRelationshipQuestionPlan({
      accountId: message.body.accountId,
      mode: relationshipQuestionMode,
      messages: context.messages,
      currentUserMessageIds: context.currentUserMessageIds,
      diagnoses: relationshipDiagnoses,
    });
    const scopedBrainMemories = relationshipPlan.active
      ? selectFullRelationshipHistory(relationshipPlan.context, loadedBrainMemories)
      : loadedBrainMemories;
    const goalMemories = goalFollowUp
      ? [
          ...scopedBrainMemories.filter(
            ({ brainItemId }) => brainItemId !== goalFollowUp.brainItemId,
          ),
          goalFollowUp,
        ]
      : scopedBrainMemories;
    const selfCareIds = new Set(selfCareMemories.map(({ brainItemId }) => brainItemId));
    const brainMemories = [
      ...goalMemories.filter(({ brainItemId }) => !selfCareIds.has(brainItemId)),
      ...selfCareMemories,
    ];
    const collectionCandidates =
      pendingResponse ||
      safetyRoute !== "normal" ||
      quotaResponse ||
      collectedPromptContextKinds === undefined
        ? []
        : buildPromptContextCollectionCandidates({
            collectedKinds: collectedPromptContextKinds,
            askedTargets: context.collectionAskedTargets,
          });
    const response = quotaResponse
      ? quotaResponse
      : pendingResponse
        ? {
            reply: pendingResponse.body,
            endSession: pendingResponse.endSession,
            dailyPromptFollowUp: undefined,
            collectionTarget: undefined,
            brainUsages: [],
            usedBrainItems: pendingResponse.usedBrainItems,
          }
        : await atBoundary(
            () =>
              generateDiaryChatResponse(
                relationshipPlan.messages,
                workerConfig,
                generationController.signal,
                {
                  currentUserMessageIds: context.currentUserMessageIds,
                  brainMemories,
                  ...(relationshipPlan.active
                    ? { relationshipQuestion: relationshipPlan.context }
                    : {}),
                  onUsage: createGeminiUsageRecorder(cf.d1, "diary_chat", message.body.accountId),
                  prompt: {
                    objective: DEFAULT_DIARY_CHAT_PROMPT_OPTIONS.objective,
                    conversationGuidance: getDiaryChatConversationGuidance(
                      context.conversationPolicyId,
                    ),
                    collectionCandidates,
                  },
                },
              ).then((generated) => {
                const memoryByContextId = new Map<string, (typeof brainMemories)[number]>(
                  brainMemories.map((memory, index) => [`memory-${index + 1}`, memory] as const),
                );
                const usedMemories = generated.used_memory_ids.flatMap((id) => {
                  const memory = memoryByContextId.get(id);
                  return memory ? [memory] : [];
                });
                return {
                  reply: generated.reply,
                  endSession: generated.end_session,
                  dailyPromptFollowUp:
                    generated.daily_prompt_follow_up === "none"
                      ? undefined
                      : generated.daily_prompt_follow_up,
                  collectionTarget: generated.collection_target,
                  usedBrainItems: usedMemories,
                  brainUsages: usedMemories.map((memory) => ({
                    brainItemId: memory.brainItemId,
                    sourceRecordIds: memory.evidence.map(({ sourceRecordId }) => sourceRecordId),
                  })),
                };
              }),
            {
              code: "DIARY_CHAT_GENERATION_FAILED",
              category: "dependency",
              stage: "ai.generate",
              retryable: true,
              dependency: "google-ai",
            },
          );
    const developmentBrainUsageMessage = buildDevelopmentBrainUsageMessage(
      response.usedBrainItems,
      workerConfig.environment,
    );

    if (!pendingResponse) {
      const leaseIsActive = await atBoundary(
        () =>
          coordinatorClient.isGenerationLeaseActive(
            message.body.turnId,
            message.body.generationEpoch,
            lease?.leaseToken ?? "",
          ),
        {
          code: "GENERATION_LEASE_CHECK_FAILED",
          category: "dependency",
          stage: "generation.validate",
          retryable: true,
          dependency: "conversation-coordinator",
        },
      );
      if (!leaseIsActive) {
        throw invariantError({
          code: "GENERATION_LEASE_EXPIRED_BEFORE_PERSISTENCE",
          category: "concurrency",
          stage: "generation.validate",
          retryable: true,
        });
      }
      await atBoundary(
        () =>
          accountDataClient.execute("conversation.saveAssistantResponse", {
            turnId: message.body.turnId,
            body: response.reply,
            endSession: response.endSession,
            ...(response.dailyPromptFollowUp
              ? { dailyPromptFollowUp: response.dailyPromptFollowUp }
              : {}),
            ...(response.collectionTarget ? { collectionTarget: response.collectionTarget } : {}),
            brainUsages: response.brainUsages,
          }),
        {
          code: "ASSISTANT_RESPONSE_SAVE_FAILED",
          category: "dependency",
          stage: "response.save",
          retryable: true,
          dependency: "account-data",
        },
      );
    }

    if (!(await sessionActive())) {
      await closeInactiveTurn();
      return;
    }

    const delivery = await atBoundary<TurnDeliveryResult>(
      () =>
        coordinatorClient.deliverTurn({
          turnId: message.body.turnId,
          generationEpoch: message.body.generationEpoch,
          leaseToken: lease?.leaseToken ?? "",
          kind: "final",
          text: response.reply,
          ...(developmentBrainUsageMessage
            ? { additionalTexts: [developmentBrainUsageMessage] }
            : {}),
        }),
      {
        code: "LINE_FINAL_DELIVERY_FAILED",
        category: "dependency",
        stage: "line.deliver",
        retryable: true,
        dependency: "line",
      },
    );
    if (delivery.status === "lease_expired") {
      throw invariantError({
        code: "GENERATION_LEASE_EXPIRED_BEFORE_DELIVERY",
        category: "concurrency",
        stage: "line.deliver",
        retryable: true,
      });
    }
    if (delivery.status === "superseded" || delivery.status === "permanent_failure") {
      if (aiUsageReserved) {
        await accountDataClient.execute("aiUsage.release", message.body.turnId);
        aiUsageReserved = false;
      }
      await atBoundary(
        () =>
          accountDataClient.execute(
            "conversation.markTurnFailed",
            message.body.turnId,
            "final_delivery",
          ),
        {
          code: "FINAL_DELIVERY_STATE_UPDATE_FAILED",
          category: "dependency",
          stage: "turn.fail",
          retryable: true,
          dependency: "account-data",
        },
      );
      await atBoundary(
        () =>
          coordinatorClient.failGeneration(
            message.body.turnId,
            message.body.generationEpoch,
            lease?.leaseToken ?? "",
          ),
        {
          code: "GENERATION_FAILURE_FINALIZE_FAILED",
          category: "dependency",
          stage: "generation.fail",
          retryable: true,
          dependency: "conversation-coordinator",
        },
      );
      message.ack();
      logTerminal(message, workerConfig, startedAt, traceFields, {
        outcome: "failed",
        disposition: "ack",
        stage: "line.deliver",
        resultCode:
          delivery.status === "superseded"
            ? "FINAL_DELIVERY_SUPERSEDED"
            : "FINAL_DELIVERY_PERMANENT_FAILURE",
      });
      return;
    }

    const markedDelivered = await atBoundary(
      () => accountDataClient.execute("conversation.markTurnDelivered", message.body.turnId),
      {
        code: "DELIVERED_TURN_STATE_UPDATE_FAILED",
        category: "dependency",
        stage: "turn.deliver",
        retryable: true,
        dependency: "account-data",
      },
    );
    if (!markedDelivered) {
      throw invariantError({
        code: "DELIVERED_TURN_STATE_NOT_UPDATED",
        category: "invariant",
        stage: "turn.deliver",
        retryable: true,
      });
    }
    if (aiUsageReserved) {
      await atBoundary(() => accountDataClient.execute("aiUsage.commit", message.body.turnId), {
        code: "AI_REPLY_USAGE_COMMIT_FAILED",
        category: "dependency",
        stage: "entitlement.commit",
        retryable: true,
        dependency: "account-data",
      });
      aiUsageReserved = false;
    }
    if (response.endSession) {
      await atBoundary(
        () => accountDataClient.execute("conversation.closeTurnSession", message.body.turnId),
        {
          code: "CHAT_SESSION_CLOSE_FAILED",
          category: "dependency",
          stage: "session.close",
          retryable: true,
          dependency: "account-data",
        },
      );
    }
    const completed = await atBoundary(
      () =>
        coordinatorClient.completeGeneration(
          message.body.turnId,
          message.body.generationEpoch,
          lease?.leaseToken ?? "",
        ),
      {
        code: "GENERATION_COMPLETE_FAILED",
        category: "dependency",
        stage: "generation.complete",
        retryable: true,
        dependency: "conversation-coordinator",
      },
    );
    message.ack();
    logTerminal(message, workerConfig, startedAt, traceFields, {
      outcome: completed ? "succeeded" : "degraded",
      disposition: "ack",
      stage: "line.deliver",
      ...(!completed ? { resultCode: "GENERATION_LEASE_EXPIRED_AFTER_DELIVERY" } : {}),
    });
  } catch (caughtError) {
    let error = caughtError;
    if (
      lease &&
      coordinator &&
      accountData &&
      settleFailureDelivery &&
      (message.attempts >= 2 || controller?.signal.aborted) &&
      !failureDeliveryAttempted
    ) {
      try {
        failureDeliveryAttempted = true;
        const settlement = await settleFailureDelivery();
        if (settlement) {
          message.ack();
          logTerminal(message, workerConfig, startedAt, traceFields, {
            outcome: settlement === "failure-notice-delivered" ? "degraded" : "failed",
            disposition: "ack",
            stage: "line.failure-deliver",
            resultCode:
              settlement === "failure-notice-delivered"
                ? "FAILURE_NOTICE_DELIVERED"
                : "FAILURE_NOTICE_PERMANENT_FAILURE",
            error: caughtError,
          });
          return;
        }
      } catch (settlementError) {
        error = settlementError;
      }
    }
    if (lease && coordinator) {
      const coordinatorClient = coordinator;
      try {
        await atBoundary(
          () =>
            coordinatorClient.releaseGeneration(
              message.body.turnId,
              message.body.generationEpoch,
              lease?.leaseToken ?? "",
            ),
          {
            code: "GENERATION_LEASE_RELEASE_FAILED",
            category: "dependency",
            stage: "generation.release",
            retryable: true,
            dependency: "conversation-coordinator",
          },
        );
      } catch (releaseError) {
        error = releaseError;
      }
    }
    if (aiUsageReserved && accountData && message.attempts >= CHAT_TURN_MAX_ATTEMPTS) {
      try {
        await accountData.execute("aiUsage.release", message.body.turnId);
        aiUsageReserved = false;
      } catch (releaseError) {
        error = releaseError;
      }
    }
    const operationalError = toOperationalError(error, {
      code: "UNEXPECTED_CHAT_TURN_ERROR",
      category: "unknown",
      stage: "chat-turn.process",
      retryable: true,
    });
    const disposition = operationalError.retryable
      ? message.attempts >= CHAT_TURN_MAX_ATTEMPTS
        ? "dead-letter"
        : "retry"
      : "ack";
    if (operationalError.retryable) message.retry();
    else message.ack();
    logTerminal(message, workerConfig, startedAt, traceFields, {
      outcome: "failed",
      disposition,
      stage: operationalError.stage,
      error: operationalError,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
