import { DurableObject } from "cloudflare:workers";
import {
  type AccountDataArgs,
  type AccountDataOperation,
  type AccountDataResult,
  d1,
} from "@me-builder/lib";
import { eq, inArray } from "drizzle-orm";
import type { Env } from "../types";
import { brainActions } from "./brain";
import { diagnosisActions } from "./diagnosis";
import { diaryActions } from "./diary";
import {
  AccountDataRepository,
  type DiagnosisCatalogSnapshot,
  type LegacyAccountDataSnapshot,
} from "./repository";

const actions = {
  ...brainActions,
  ...diagnosisActions,
  ...diaryActions,
} as const;

/** 1 AccountのSource / Brain / Diagnosis / Diaryを1つのprivate SQLiteに保存する。 */
export class AccountData extends DurableObject<Env> {
  private readonly accountId: string;
  private readonly repository: AccountDataRepository;
  private legacyImport: Promise<void> | undefined;

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
    if (typeof accountId !== "string" || accountId.length === 0) {
      throw new Error("AccountData account is required");
    }
    if (accountId !== this.accountId) {
      throw new Error("AccountData RPC account does not match object name");
    }
    const action = (actions as Partial<Record<AccountDataOperation, unknown>>)[operation];
    if (typeof action !== "function") throw new Error("Unsupported AccountData operation");
    const boundAction = action as (
      db: d1.Client,
      boundAccountId: string,
      ...actionArgs: AccountDataArgs<TOperation>
    ) => Promise<AccountDataResult<TOperation>>;

    this.repository.bindAccount(accountId);
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
  }

  async alarm(): Promise<void> {
    await d1.action.conversation.closeExpiredSessions(this.repository.client);
    await d1.action.diagnosisBrainProjection.processPendingDiagnosisBrainProjections(
      this.repository.client,
    );
    await this.scheduleMaintenance();
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
}
