import { DurableObject } from "cloudflare:workers";
import {
  type AccountDataArgs,
  type AccountDataOperation,
  type AccountDataResult,
  d1,
} from "@me-builder/lib";
import { eq } from "drizzle-orm";
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

function assertAccountArguments(
  accountId: string,
  value: unknown,
  seen = new WeakSet<object>(),
): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) assertAccountArguments(accountId, item, seen);
    return;
  }
  if (value === null || typeof value !== "object" || value instanceof Date) return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (key === "accountId" && nested !== accountId) {
      throw new Error("AccountData operation contains another account");
    }
    assertAccountArguments(accountId, nested, seen);
  }
}

/** 1 AccountのSource / Brain / Diagnosis / Diaryを1つのprivate SQLiteに保存する。 */
export class AccountData extends DurableObject<Env> {
  private readonly repository: AccountDataRepository;
  private legacyImport: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.repository = new AccountDataRepository(ctx.storage);
    ctx.blockConcurrencyWhile(async () => this.repository.initialize());
  }

  async execute<TOperation extends AccountDataOperation>(
    accountId: string,
    operation: TOperation,
    ...args: AccountDataArgs<TOperation>
  ): Promise<AccountDataResult<TOperation>> {
    this.repository.bindAccount(accountId);
    assertAccountArguments(accountId, args);
    if (!this.legacyImport) this.legacyImport = this.importLegacyAccountData(accountId);
    try {
      await this.legacyImport;
    } catch (error) {
      this.legacyImport = undefined;
      throw error;
    }
    if (operation.startsWith("diagnosis")) await this.syncDiagnosisCatalog();

    const action = actions[operation] as unknown as (
      db: d1.Client,
      ...actionArgs: AccountDataArgs<TOperation>
    ) => Promise<AccountDataResult<TOperation>>;
    const result = await action(this.repository.client, ...args);
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
        .where(eq(d1.schema.sourceRecordTextPayloads.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.sourceRecordRevisions)
        .where(eq(d1.schema.sourceRecordRevisions.accountId, accountId))
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
        .where(eq(d1.schema.conversationMessages.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.chatTurns)
        .where(eq(d1.schema.chatTurns.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.diagnosisResponses)
        .where(eq(d1.schema.diagnosisResponses.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.diagnosisAnswers)
        .where(eq(d1.schema.diagnosisAnswers.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.diagnosisDeferredQuestions)
        .where(eq(d1.schema.diagnosisDeferredQuestions.accountId, accountId))
        .all(),
      shared
        .select()
        .from(d1.schema.diagnosisBrainProjectionRequests)
        .where(eq(d1.schema.diagnosisBrainProjectionRequests.accountId, accountId))
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
