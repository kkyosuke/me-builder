import type {
  AccountDataArgs,
  AccountDataNamespace,
  AccountDataOperation,
  AccountDataResult,
  d1,
} from "@me-builder/lib";
import { brainActions } from "../account-data/brain";
import { diagnosisActions } from "../account-data/diagnosis";
import { diaryActions } from "../account-data/diary";

const actions = { ...brainActions, ...diagnosisActions, ...diaryActions } as const;

/** 既存の共有D1 fixtureを使うE2Eだけに提供する段階移行用RPC adapter。 */
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
          const action = (actions as Partial<Record<AccountDataOperation, unknown>>)[operation];
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
