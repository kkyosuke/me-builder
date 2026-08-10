import * as action from "./action";
import { type AccountDataDatabase, accountDataSchema } from "./database";
import * as ownedSchema from "./schema";
import * as catalogSnapshot from "./schema/catalog-snapshot";

/** AccountData: 1 AccountのSource / Brain / Diary / Diagnosis回答のSSoT。 */
export const accountData = {
  action,
  schema: { ...ownedSchema, ...catalogSnapshot },
};

export namespace accountData {
  export type Database = AccountDataDatabase;
}

export { accountDataSchema };
export type { AccountDataDatabase } from "./database";
export * from "./rpc";
export type { ConversationContextMessage } from "./action/diary";
