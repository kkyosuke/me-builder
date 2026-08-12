import { DO } from "@me-builder/lib";

/** 開発環境で本人のAccountData個人コンテンツを初期化する。 */
export const developmentActions = {
  "development.deleteAllAccountData": (db: DO.account.Database, accountId: string, at?: Date) =>
    DO.account.action.development.deleteAllDevelopmentAccountData(db, accountId, at),
} as const;
