import { DurableObject } from "cloudflare:workers";
import {
  type AccountDataArgs,
  type AccountDataOperation,
  type AccountDataResult,
  d1,
} from "@me-builder/lib";
import type { Env } from "../types";
import { brainActions } from "./brain";
import { diagnosisActions } from "./diagnosis";
import { diaryActions } from "./diary";
import { AccountDataRepository, type DiagnosisCatalogSnapshot } from "./repository";

const actions = {
  ...brainActions,
  ...diagnosisActions,
  ...diaryActions,
} as const;

function assertAccountArguments(accountId: string, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertAccountArguments(accountId, item);
    return;
  }
  if (value === null || typeof value !== "object" || value instanceof Date) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "accountId" && nested !== accountId) {
      throw new Error("AccountData operation contains another account");
    }
    assertAccountArguments(accountId, nested);
  }
}

/** 1 AccountのSource / Brain / Diagnosis / Diaryを1つのprivate SQLiteに保存する。 */
export class AccountData extends DurableObject<Env> {
  private readonly repository: AccountDataRepository;

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

  private async scheduleMaintenance(): Promise<void> {
    const desired = this.repository.nextMaintenanceAt();
    if (desired === null) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || desired < current) await this.ctx.storage.setAlarm(desired);
  }
}
