import {
  type AccountDataArgs,
  type AccountDataNamespace,
  type AccountDataOperation,
  type AccountDataResult,
  d1,
} from "@me-builder/lib";

const actions = {
  "diagnosis.deleteAccountData": (db: d1.Client, accountId: string) =>
    d1.action.diagnosis.deleteAccountDiagnosisData(db, accountId),
  "diagnosis.deferQuestion": (
    db: d1.Client,
    accountId: string,
    input: Omit<Parameters<typeof d1.action.diagnosis.deferDiagnosisQuestion>[1], "accountId">,
  ) => d1.action.diagnosis.deferDiagnosisQuestion(db, { ...input, accountId }),
  "diagnosis.saveAnswer": (
    db: d1.Client,
    accountId: string,
    input: Omit<Parameters<typeof d1.action.diagnosis.saveDiagnosisAnswer>[1], "accountId">,
  ) => d1.action.diagnosis.saveDiagnosisAnswer(db, { ...input, accountId }),
  "diagnosis.findAnswers": (db: d1.Client, accountId: string, diagnosisId: string, at: Date) =>
    d1.action.diagnosis.findDiagnosisAnswers(db, accountId, diagnosisId, at),
  "diagnosis.listVisible": (db: d1.Client, accountId: string, at: Date) =>
    d1.action.diagnosis.listVisibleDiagnoses(db, accountId, at),
  "source.hasActive": (db: d1.Client, accountId: string) =>
    d1.action.source.hasActiveSourceRecords(db, accountId),
  "diagnosisProjection.processLatest": (
    db: d1.Client,
    accountId: string,
    diagnosisId: string,
    at?: Date,
  ) =>
    d1.action.diagnosisBrainProjection.processLatestDiagnosisBrainProjection(
      db,
      accountId,
      diagnosisId,
      at,
    ),
} as const;

/** APIのD1 fixtureを既存E2Eから段階移行するためのtest専用RPC adapter。 */
export function createD1AccountDataTestNamespace(db: d1.Client): AccountDataNamespace {
  return {
    getByName(name) {
      return {
        async execute<TOperation extends AccountDataOperation>(
          accountId: string,
          operation: TOperation,
          ...args: AccountDataArgs<TOperation>
        ): Promise<AccountDataResult<TOperation>> {
          if (accountId !== name) throw new Error("AccountData test routing mismatch");
          const action = actions[operation as keyof typeof actions];
          if (!action) throw new Error(`Unsupported AccountData test operation: ${operation}`);
          return (await (action as unknown as (...input: unknown[]) => Promise<unknown>)(
            db,
            accountId,
            ...args,
          )) as AccountDataResult<TOperation>;
        },
      };
    },
  };
}
