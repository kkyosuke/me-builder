import * as accountAction from "./account/action";
import { type AccountDataDatabase, accountSchema } from "./account/database";

/**
 * Durable Objectが保存するdatabase。
 *
 * `account`は1 AccountのSource / Brain / Diary / Diagnosis回答のSSoT。
 * 境界は`docs/architecture/account-data-isolation.md`を正とする。
 */
const account = {
  action: accountAction,
  schema: accountSchema,
};

export const DO = { account };

export namespace DO {
  export namespace account {
    export type Database = AccountDataDatabase;
  }
}

export { accountSchema } from "./account/database";
export * from "./account/rpc";
export type { ActiveBrainVectorEntry, AppliedBrainVectorSync } from "./account/action/brain";
export type { ConversationContextMessage } from "./account/action/diary";
