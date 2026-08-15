import { DurableObject } from "cloudflare:workers";
import {
  type AccountDataArgs,
  type AccountDataOperation,
  type AccountDataResult,
  type CompatibilityReference,
  D1,
  DIAGNOSIS_CATALOG_ID,
  DO,
  compatibilityDataFor,
} from "@me-builder/lib";
import { logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import { eq } from "drizzle-orm";
import type { Env } from "../types";
import { brainActions } from "./brain";
import { compatibilityActions } from "./compatibility";
import { developmentActions } from "./development";
import { diagnosisActions } from "./diagnosis";
import { diaryActions } from "./diary";
import { profileSummaryActions } from "./profile-summary";
import { AccountDataRepository, type DiagnosisCatalogSnapshot } from "./repository";

const actions = {
  ...brainActions,
  ...diagnosisActions,
  ...developmentActions,
  ...diaryActions,
  ...profileSummaryActions,
} as const;

const ALARM_RETRY_MS = 30_000;
const PROGRESSION_PROJECTION_STATE_KEY = "progressionProjectionState";
type ProgressionProjectionState =
  | Readonly<{ retryPending: true }>
  | Readonly<{
      retryPending: false;
      calculationVersion: number;
      growthValue: number;
      collectedPieces: number;
      activePieces: number;
    }>;
const progressionProjectionOperations = new Set<AccountDataOperation>([
  "diagnosis.deleteAccountData",
  "diagnosisProjection.processLatest",
  "conversation.applyDiaryBrainCheckpoint",
  "development.deleteAllAccountData",
  "progression.read",
]);

/** APIからQueueへ渡せなかった生成要求を、永続状態を正として同じIDで再配送する。 */
export async function dispatchUndispatchedProfileSummaryGenerations(
  db: DO.account.Database,
  accountId: string,
  queue: Env["PROFILE_SUMMARY_QUEUE"],
): Promise<number> {
  const generationIds =
    await DO.account.action.profileSummary.listUndispatchedProfileSummaryGenerationIds(
      db,
      accountId,
    );
  if (generationIds.length > 0 && !queue) {
    throw new Error("PROFILE_SUMMARY_QUEUE binding is required for Profile Summary generation");
  }
  for (const generationId of generationIds) {
    await queue?.send({
      type: "profile-summary-generation",
      accountId,
      generationId,
    });
    await DO.account.action.profileSummary.markProfileSummaryGenerationDispatched(
      db,
      accountId,
      generationId,
    );
  }
  return generationIds.length;
}

/** 1 AccountのSource / Brain / Diagnosis / Diary / Profile Summaryをprivate SQLiteに保存する。 */
export class AccountData extends DurableObject<Env> {
  private readonly accountId: string;
  private readonly repository: AccountDataRepository;
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
        db: DO.account.Database,
        boundAccountId: string,
        ...actionArgs: AccountDataArgs<TOperation>
      ) => Promise<AccountDataResult<TOperation>>;

      if (operation.startsWith("diagnosis")) await this.syncDiagnosisCatalog();
      const result = await boundAction(this.repository.client, accountId, ...args);
      if (operation === "progression.read") {
        await this.syncProgressionProjection(result as AccountDataResult<"progression.read">);
      } else if (progressionProjectionOperations.has(operation)) {
        await this.syncProgressionProjection();
      }
      await this.scheduleMaintenance();
      return result;
    });
  }

  async alarm(): Promise<void> {
    await this.runExclusive(async () => {
      try {
        await DO.account.action.diary.closeExpiredSessions(this.repository.client);
        const diagnosisProjection =
          await DO.account.action.diagnosisBrainProjection.processPendingDiagnosisBrainProjections(
            this.repository.client,
          );
        const progressionProjectionState = await this.ctx.storage.get<ProgressionProjectionState>(
          PROGRESSION_PROJECTION_STATE_KEY,
        );
        if (diagnosisProjection.applied > 0 || progressionProjectionState?.retryPending) {
          await this.syncProgressionProjection();
        }
        await dispatchUndispatchedProfileSummaryGenerations(
          this.repository.client,
          this.accountId,
          this.env.PROFILE_SUMMARY_QUEUE,
        );
        const checkpointClaim = await DO.account.action.diary.claimDueDiaryBrainCheckpointIds(
          this.repository.client,
          this.accountId,
        );
        for (const failure of checkpointClaim.terminalFailures) {
          logger.error(
            {
              event: "diary-brain-checkpoint.job.failed",
              service: "worker",
              component: "account-data",
              checkpointId: failure.checkpointId,
              outcome: "failed",
              disposition: "stop",
              stage: "checkpoint.dispatch",
              errorCode: failure.failureCode,
              errorCategory: "timeout",
              retryable: false,
              attempt: failure.attemptCount,
              maxAttempts: DO.account.action.diary.DIARY_BRAIN_CHECKPOINT_MAX_DISPATCH_ATTEMPTS,
            },
            `[Diary Brain checkpoint] failed at checkpoint.dispatch -> stop (attempt ${failure.attemptCount}/${DO.account.action.diary.DIARY_BRAIN_CHECKPOINT_MAX_DISPATCH_ATTEMPTS}, ${failure.failureCode}, category:timeout)`,
          );
        }
        const checkpointIds = checkpointClaim.checkpointIds;
        if (checkpointIds.length > 0 && !this.env.BRAIN_CHECKPOINT_QUEUE) {
          throw new Error("BRAIN_CHECKPOINT_QUEUE binding is required for diary Brain checkpoints");
        }
        for (const checkpointId of checkpointIds) {
          await this.env.BRAIN_CHECKPOINT_QUEUE?.send({
            type: "diary-brain-checkpoint",
            accountId: this.accountId,
            checkpointId,
          });
          const dispatched = await DO.account.action.diary.markDiaryBrainCheckpointDispatched(
            this.repository.client,
            this.accountId,
            checkpointId,
          );
          if (!dispatched) {
            throw new Error("Diary Brain checkpoint dispatch state could not be recorded");
          }
        }
        const vectorClaim = await DO.account.action.brain.claimDueBrainVectorSyncJobs(
          this.repository.client,
        );
        for (const failure of vectorClaim.terminalFailures) {
          logger.error(
            {
              event: "brain-vector-sync.job.failed",
              service: "worker",
              component: "account-data",
              jobId: failure.jobId,
              brainItemId: failure.brainItemId,
              outcome: "failed",
              disposition: "stop",
              jobStatus: "failed",
              terminalReason: "attempts-exhausted",
              stage: "vector.dispatch",
              errorCode: failure.failureCode,
              errorCategory: "unknown",
              retryable: false,
              attempt: failure.attemptCount,
              maxAttempts: DO.account.action.brain.BRAIN_VECTOR_SYNC_MAX_ATTEMPTS,
            },
            `[Brain vector sync] failed at vector.dispatch -> stop (attempt ${failure.attemptCount}/${DO.account.action.brain.BRAIN_VECTOR_SYNC_MAX_ATTEMPTS}, ${failure.failureCode}, category:unknown)`,
          );
        }
        const vectorJobs = vectorClaim.jobs;
        if (vectorJobs.length > 0 && !this.env.BRAIN_VECTOR_QUEUE) {
          throw new Error("BRAIN_VECTOR_QUEUE binding is required for Brain vector sync");
        }
        for (const job of vectorJobs) {
          await this.env.BRAIN_VECTOR_QUEUE?.send({
            type: "brain-vector-sync",
            accountId: this.accountId,
            jobId: job.id,
            brainItemId: job.brainItemId,
            itemRevision: job.itemRevision,
          });
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
        const { acceptedAt } = relationship;
        const partnerAccountId =
          relationship.inviterAccountId === this.accountId
            ? relationship.inviteeAccountId
            : relationship.inviterAccountId;
        if (!partnerAccountId || !acceptedAt) {
          throw new Error(
            "Accepted compatibility relationship must have both participants and acceptedAt",
          );
        }
        const activation = this.repository.activateCompatibilityReference(this.accountId, {
          relationshipId: reference.relationshipId,
          partnerAccountId,
          role: reference.role,
          updatedAt: acceptedAt,
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

  /**
   * 公開定義snapshotを、共有D1が公開している版と一致しないときだけ読み直す。
   *
   * 版が同じならRPCあたり1行のqueryで済み、定義が増えても操作コストが増えない。
   *
   * 共有D1が版を公開していない間はsnapshotを最新と見なさず、毎回読み直す。
   * 版なしを0として同期済みに固定すると、seed適用前に作られたObjectが空の
   * snapshotを持ち続け、以後のRPCが短絡して診断を返せなくなる。
   */
  private async syncDiagnosisCatalog(): Promise<void> {
    const shared = D1.shared.client.create(this.env.DB);
    const published = await shared
      .select({ version: D1.shared.schema.catalogVersions.version })
      .from(D1.shared.schema.catalogVersions)
      .where(eq(D1.shared.schema.catalogVersions.catalogId, DIAGNOSIS_CATALOG_ID))
      .get();
    if (published && this.repository.isDiagnosisCatalogCurrent(published.version)) return;
    const version = published?.version ?? 0;

    const [
      questions,
      questionVersions,
      questionChoices,
      scoringConfigs,
      diagnoses,
      diagnosisQuestions,
    ] = await Promise.all([
      shared.select().from(D1.shared.schema.questions),
      shared.select().from(D1.shared.schema.questionVersions),
      shared.select().from(D1.shared.schema.questionChoices),
      shared.select().from(D1.shared.schema.diagnosisScoringConfigs),
      shared.select().from(D1.shared.schema.diagnoses),
      shared.select().from(D1.shared.schema.diagnosisQuestions),
    ]);
    this.repository.syncDiagnosisCatalog({
      version,
      questions,
      questionVersions,
      questionChoices,
      scoringConfigs,
      diagnoses,
      diagnosisQuestions,
    } satisfies DiagnosisCatalogSnapshot);
  }

  /** 個人コンテンツを含めず、管理者一覧に必要な現在集計だけを共有D1へ同期する。 */
  private async syncProgressionProjection(
    knownProgression?: AccountDataResult<"progression.read">,
  ): Promise<void> {
    try {
      const projectedAt = new Date();
      const progression =
        knownProgression ??
        (await DO.account.action.progression.readUtsushiProgression(
          this.repository.client,
          this.accountId,
          projectedAt,
        ));
      const projectionState = await this.ctx.storage.get<ProgressionProjectionState>(
        PROGRESSION_PROJECTION_STATE_KEY,
      );
      if (
        projectionState &&
        !projectionState.retryPending &&
        projectionState.calculationVersion === progression.calculationVersion &&
        projectionState.growthValue === progression.growthValue &&
        projectionState.collectedPieces === progression.collectedPieces &&
        projectionState.activePieces === progression.activePieces
      ) {
        return;
      }
      await D1.shared.action.adminAccount.upsertAccountProgressionProjection(
        D1.shared.client.create(this.env.DB),
        this.accountId,
        progression,
        projectedAt,
      );
      await this.ctx.storage.put(PROGRESSION_PROJECTION_STATE_KEY, {
        retryPending: false,
        calculationVersion: progression.calculationVersion,
        growthValue: progression.growthValue,
        collectedPieces: progression.collectedPieces,
        activePieces: progression.activePieces,
      } satisfies ProgressionProjectionState);
    } catch (error) {
      await this.ctx.storage.put(PROGRESSION_PROJECTION_STATE_KEY, { retryPending: true });
      logger.warn(
        {
          event: "account-progression.projection.deferred",
          service: "worker",
          component: "account-data",
          outcome: "deferred",
          disposition: "alarm-retry",
          ...toSafeOperationalErrorFields(error, {
            code: "ACCOUNT_PROGRESSION_PROJECTION_DEFERRED",
            category: "dependency",
            stage: "progression.project",
            retryable: true,
          }),
        },
        "[Account progression] deferred at progression.project -> alarm-retry",
      );
      await this.scheduleMaintenanceRetry();
    }
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
