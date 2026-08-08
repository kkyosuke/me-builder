import {
  type AccountDataArgs,
  type AccountDataNamespace,
  type AccountDataOperation,
  type AccountDataResult,
  d1,
} from "@me-builder/lib";

const actions = {
  "diagnosis.deleteAccountData": d1.action.diagnosis.deleteAccountDiagnosisData,
  "diagnosis.deferQuestion": d1.action.diagnosis.deferDiagnosisQuestion,
  "diagnosis.saveAnswer": d1.action.diagnosis.saveDiagnosisAnswer,
  "diagnosis.findAnswers": d1.action.diagnosis.findDiagnosisAnswers,
  "diagnosis.listVisible": d1.action.diagnosis.listVisibleDiagnoses,
  "source.hasActive": d1.action.source.hasActiveSourceRecords,
  "diagnosisProjection.processLatest":
    d1.action.diagnosisBrainProjection.processLatestDiagnosisBrainProjection,
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
            ...args,
          )) as AccountDataResult<TOperation>;
        },
      };
    },
  };
}
