import { DurableObject } from "cloudflare:workers";
import {
  type AccountDataArgs,
  type AccountDataOperation,
  type AccountDataResult,
  type CompatibilityReference,
  compatibilityDataFor,
  d1,
} from "@me-builder/lib";
import { logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import { eq, inArray } from "drizzle-orm";
import type { Env } from "../types";
import {
  avatarActions,
  listPendingAvatarObjectDeletions,
  markAvatarObjectDeleted,
  retryAvatarObjectDeletion,
} from "./avatar";
import { brainActions } from "./brain";
import { compatibilityActions } from "./compatibility";
import { diagnosisActions } from "./diagnosis";
import { diaryActions } from "./diary";
import {
  AccountDataRepository,
  type DiagnosisCatalogSnapshot,
  type LegacyAccountDataSnapshot,
} from "./repository";

const actions = {
  ...avatarActions,
  ...brainActions,
  ...diagnosisActions,
  ...diaryActions,
} as const;

const ALARM_RETRY_MS = 30_000;

/** 1 AccountのSource / Brain / Diagnosis / Diaryを1つのprivate SQLiteに保存する。 */
export class AccountData extends DurableObject<Env> {
  private readonly accountId: string;
  private readonly repository: AccountDataRepository;
  private legacyImport: Promise<void> | undefined;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const accountId = ctx.id.name;
    if (!accountId) throw new Error("AccountData must be addressed by account name");
    this.accountId = accountId;
    this.repository = new AccountDataRepository(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      await this.repository.initialize();
      this.repository.bindAccount(accountId);
    });
  }

  async execute<TOperation extends AccountDataOperation>(
    accountId: string,
    operation: TOperation,
    ...args: AccountDataArgs<TOperation>
  ): Promise<AccountDataResult<TOperation>> {
    return this.runExclusive(async () => {
      if (typeof accountId !== "string" || accountId.length === 0) {
        throw new Error("AccountData account is required");
      }
      if (accountId !== this.accountId) {
        throw new Error("AccountData RPC account does not match object name");
      }
      this.repository.bindAccount(accountId);
      if (operation === "compatibility.listVisibleReferences") {
        return (await this.listVisibleCompatibilityReferences()) as AccountDataResult<TOperation>;
      }
      if (operation.startsWith("compatibility.")) {
        const action = (compatibilityActions as Partial<Record<AccountDataOperation, unknown>>)[
          operation
        ];
        if (typeof action !== "function") throw new Error("Unsupported AccountData operation");
        const boundAction = action as (
          repository: AccountDataRepository,
          boundAccountId: string,
          ...actionArgs: AccountDataArgs<TOperation>
        ) => AccountDataResult<TOperation>;
        return boundAction(this.repository, accountId, ...args);
      }

      const action = (actions as Partial<Record<AccountDataOperation, unknown>>)[operation];
      if (typeof action !== "function") throw new Error("Unsupported AccountData operation");
      const boundAction = action as (
        db: d1.Client,
        boundAccountId: string,
        ...actionArgs: AccountDataArgs<TOperation>
      ) => Promise<AccountDataResult<TOperation>>;

      if (!this.legacyImport) this.legacyImport = this.importLegacyAccountData(accountId);
      try {
        await this.legacyImport;
      } catch (error) {
        this.legacyImport = undefined;
        throw error;
      }
      if (operation.startsWith("diagnosis")) await this.syncDiagnosisCatalog();
      const result = await boundAction(this.repository.client, accountId, ...args);
      await this.scheduleMaintenance();
      return result;
    });
  }

  async alarm(): Promise<void> {
    await this.runExclusive(async () => {
      try {
        await d1.action.conversation.closeExpiredSessions(this.repository.client);
        await d1.action.diagnosisBrainProjection.processPendingDiagnosisBrainProjections(
          this.repository.client,
        );
        const checkpointIds = await d1.action.conversation.claimDueDiaryBrainCheckpointIds(
          this.repository.client,
          this.accountId,
        );
        if (checkpointIds.length > 0 && !this.env.BRAIN_CHECKPOINT_QUEUE) {
          throw new Error("BRAIN_CHECKPOINT_QUEUE binding is required for diary Brain checkpoints");
        }
        for (const checkpointId of checkpointIds) {
          await this.env.BRAIN_CHECKPOINT_QUEUE?.send({
            type: "diary-brain-checkpoint",
            accountId: this.accountId,
            checkpointId,
          });
          const dispatched = await d1.action.conversation.markDiaryBrainCheckpointDispatched(
            this.repository.client,
            this.accountId,
            checkpointId,
          );
          if (!dispatched) {
            throw new Error("Diary Brain checkpoint dispatch state could not be recorded");
          }
        }
        const pending = await avatarActions["avatar.listPendingEnqueues"](
          this.repository.client,
          this.accountId,
        );
        for (const item of pending) {
          try {
            if (!this.env.AVATAR_QUEUE) throw new Error("Avatar Queue binding is not configured");
            await this.env.AVATAR_QUEUE.send({
              type: "avatar",
              traceId: item.jobId,
              accountId: this.accountId,
              jobId: item.jobId,
              operation: item.operation,
            });
            await avatarActions["avatar.markEnqueued"](
              this.repository.client,
              this.accountId,
              item.jobId,
              item.operation,
            );
          } catch (error) {
            await avatarActions["avatar.recordEnqueueFailure"](
              this.repository.client,
              this.accountId,
              item.jobId,
              item.operation,
            );
            logger.warn(
              { errorName: error instanceof Error ? error.name : "UnknownError" },
              "Avatar Queue enqueue failed; AccountData alarm will retry",
            );
          }
        }
        if (this.env.AVATAR_BUCKET) {
          const deletions = await listPendingAvatarObjectDeletions(this.repository.client);
          for (const deletion of deletions) {
            try {
              await this.env.AVATAR_BUCKET.delete(deletion.objectKey);
              await markAvatarObjectDeleted(this.repository.client, deletion.objectKey);
            } catch (error) {
              await retryAvatarObjectDeletion(
                this.repository.client,
                deletion.objectKey,
                deletion.attemptCount,
              );
              logger.warn(
                { errorName: error instanceof Error ? error.name : "UnknownError" },
                "Avatar R2 deletion failed; AccountData alarm will retry",
              );
            }
          }
        }
        await this.scheduleMaintenance();
      } catch (error) {
        logger.error(
          {
            event: "alarm.run.failed",
            service: "worker",
            component: "account-data",
            outcome: "failed",
            disposition: "alarm-retry",
            ...toSafeOperationalErrorFields(error, {
              code: "ACCOUNT_DATA_ALARM_FAILED",
              category: "unknown",
              stage: "alarm.maintenance",
              retryable: true,
            }),
          },
          "[AccountData] alarm failed at alarm.maintenance -> alarm-retry (maintenance will be retried on the next alarm)",
        );
        await this.scheduleMaintenanceRetry();
      }
    });
  }

  /** 一覧projectionをCompatibilityDataの現在状態へ同期してから返す。 */
  private async listVisibleCompatibilityReferences(): Promise<readonly CompatibilityReference[]> {
    const namespace = this.env.COMPATIBILITY_DATA;
    if (!namespace) throw new Error("CompatibilityData binding is required");

    const references = this.repository.listReconciliableCompatibilityReferences(this.accountId);
    for (const reference of references) {
      const relationshipData = compatibilityDataFor(namespace, reference.relationshipId);
      const relationship = await relationshipData.getRelationship(this.accountId);
      if (relationship) {
        const partnerAccountId =
          relationship.inviterAccountId === this.accountId
            ? relationship.inviteeAccountId
            : relationship.inviterAccountId;
        if (!partnerAccountId) {
          throw new Error("Accepted compatibility relationship must have both participants");
        }
        const activation = this.repository.activateCompatibilityReference(this.accountId, {
          relationshipId: reference.relationshipId,
          partnerAccountId,
          role: reference.role,
          updatedAt: new Date(),
        });
        if (activation.outcome === "conflict") {
          throw new Error("Accepted compatibility relationship conflicts with another reference");
        }
        continue;
      }

      if (reference.status === "pending" || reference.status === "reserved") {
        const preview = await relationshipData.getInvitationPreview(this.accountId);
        if (preview) continue;
      }
      this.repository.endCompatibilityReference(
        this.accountId,
        reference.relationshipId,
        new Date(),
      );
    }
    return this.repository.listVisibleCompatibilityReferences(this.accountId);
  }

  private async syncDiagnosisCatalog(): Promise<void> {
    const shared = d1.client.create(this.env.DB);
    const [
      questions,
      questionVersions,
      questionChoices,
      scoringConfigs,
      diagnoses,
      diagnosisQuestions,
    ] = await Promise.all([
      shared.select().from(d1.schema.questions),
      shared.select().from(d1.schema.questionVersions),
      shared.select().from(d1.schema.questionChoices),
      shared.select().from(d1.schema.diagnosisScoringConfigs),
      shared.select().from(d1.schema.diagnoses),
      shared.select().from(d1.schema.diagnosisQuestions),
    ]);
    this.repository.syncDiagnosisCatalog({
      questions,
      questionVersions,
      questionChoices,
      scoringConfigs,
      diagnoses,
      diagnosisQuestions,
    } satisfies DiagnosisCatalogSnapshot);
  }

  private async importLegacyAccountData(accountId: string): Promise<void> {
    if (this.repository.isLegacyImportComplete()) return;
    await this.syncDiagnosisCatalog();
    const shared = d1.client.create(this.env.DB);
    const account = await shared
      .select()
      .from(d1.schema.accounts)
      .where(eq(d1.schema.accounts.id, accountId))
      .get();
    if (!account) throw new Error("AccountData source account was not found in shared identity DB");
    const [
      sourceRecords,
      sourceRecordTextPayloads,
      sourceRecordRevisions,
      brainItems,
      brainItemEvidenceEdges,
      brainItemRevisions,
      brainItemAccessLabels,
      brainItemTopicLabels,
      conversationSessions,
      conversationMessages,
      chatTurns,
      diagnosisResponses,
      diagnosisAnswers,
      diagnosisDeferredQuestions,
      diagnosisBrainProjectionRequests,
      diagnosisBrainProjectionHeads,
    ] = await Promise.all([
      shared
        .select()
        .from(d1.schema.sourceRecords)
        .where(eq(d1.schema.sourceRecords.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.sourceRecordTextPayloads)
        .where(
          inArray(
            d1.schema.sourceRecordTextPayloads.sourceRecordId,
            shared
              .select({ id: d1.schema.sourceRecords.id })
              .from(d1.schema.sourceRecords)
              .where(eq(d1.schema.sourceRecords.accountId, accountId)),
          ),
        )
        .all(),
      shared
        .select()
        .from(d1.schema.sourceRecordRevisions)
        .where(
          inArray(
            d1.schema.sourceRecordRevisions.previousSourceRecordId,
            shared
              .select({ id: d1.schema.sourceRecords.id })
              .from(d1.schema.sourceRecords)
              .where(eq(d1.schema.sourceRecords.accountId, accountId)),
          ),
        )
        .all(),
      shared
        .select()
        .from(d1.schema.brainItems)
        .where(eq(d1.schema.brainItems.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.brainItemEvidenceEdges)
        .where(eq(d1.schema.brainItemEvidenceEdges.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.brainItemRevisions)
        .where(eq(d1.schema.brainItemRevisions.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.brainItemAccessLabels)
        .where(eq(d1.schema.brainItemAccessLabels.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.brainItemTopicLabels)
        .where(eq(d1.schema.brainItemTopicLabels.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.conversationSessions)
        .where(eq(d1.schema.conversationSessions.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.conversationMessages)
        .where(
          inArray(
            d1.schema.conversationMessages.sessionId,
            shared
              .select({ id: d1.schema.conversationSessions.id })
              .from(d1.schema.conversationSessions)
              .where(eq(d1.schema.conversationSessions.accountId, accountId)),
          ),
        )
        .all(),
      shared
        .select()
        .from(d1.schema.chatTurns)
        .where(
          inArray(
            d1.schema.chatTurns.sessionId,
            shared
              .select({ id: d1.schema.conversationSessions.id })
              .from(d1.schema.conversationSessions)
              .where(eq(d1.schema.conversationSessions.accountId, accountId)),
          ),
        )
        .all(),
      shared
        .select()
        .from(d1.schema.diagnosisResponses)
        .where(eq(d1.schema.diagnosisResponses.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.diagnosisAnswers)
        .where(
          inArray(
            d1.schema.diagnosisAnswers.diagnosisResponseId,
            shared
              .select({ id: d1.schema.diagnosisResponses.id })
              .from(d1.schema.diagnosisResponses)
              .where(eq(d1.schema.diagnosisResponses.accountId, accountId)),
          ),
        )
        .all(),
      shared
        .select()
        .from(d1.schema.diagnosisDeferredQuestions)
        .where(
          inArray(
            d1.schema.diagnosisDeferredQuestions.diagnosisResponseId,
            shared
              .select({ id: d1.schema.diagnosisResponses.id })
              .from(d1.schema.diagnosisResponses)
              .where(eq(d1.schema.diagnosisResponses.accountId, accountId)),
          ),
        )
        .all(),
      shared
        .select()
        .from(d1.schema.diagnosisBrainProjectionRequests)
        .where(
          inArray(
            d1.schema.diagnosisBrainProjectionRequests.diagnosisResponseId,
            shared
              .select({ id: d1.schema.diagnosisResponses.id })
              .from(d1.schema.diagnosisResponses)
              .where(eq(d1.schema.diagnosisResponses.accountId, accountId)),
          ),
        )
        .all(),
      shared
        .select()
        .from(d1.schema.diagnosisBrainProjectionHeads)
        .where(eq(d1.schema.diagnosisBrainProjectionHeads.accountId, accountId))
        .all(),
    ]);
    this.repository.importLegacyAccountData({
      account,
      sourceRecords,
      sourceRecordTextPayloads,
      sourceRecordRevisions,
      brainItems,
      brainItemEvidenceEdges,
      brainItemRevisions,
      brainItemAccessLabels,
      brainItemTopicLabels,
      conversationSessions,
      conversationMessages,
      chatTurns,
      diagnosisResponses,
      diagnosisAnswers,
      diagnosisDeferredQuestions,
      diagnosisBrainProjectionRequests,
      diagnosisBrainProjectionHeads,
    } satisfies LegacyAccountDataSnapshot);
  }

  private async scheduleMaintenance(): Promise<void> {
    const desired = this.repository.nextMaintenanceAt();
    if (desired === null) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || desired < current) await this.ctx.storage.setAlarm(desired);
  }

  private async scheduleMaintenanceRetry(): Promise<void> {
    const retryAt = Date.now() + ALARM_RETRY_MS;
    const desired = this.repository.nextMaintenanceAt();
    await this.ctx.storage.setAlarm(desired === null ? retryAt : Math.max(retryAt, desired));
  }

  private async runExclusive<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const previous = this.operationTail;
    let release: () => void = () => undefined;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
