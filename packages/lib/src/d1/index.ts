import * as sharedAction from "./shared/action";
import { type SharedD1Client, createSharedD1Client } from "./shared/client";
import * as sharedSchema from "./shared/schema";

/**
 * Cloudflare D1が保存するdatabase。
 *
 * 保存するのはAccount Identityと運営設定、全Account共通の公開定義、原文を含まない
 * 集計projection。日記や診断回答などの個人コンテンツは`DO.account`が持つ。境界は
 * `docs/architecture/account-data-isolation.md`を正とする。
 */
const shared = {
  client: { create: createSharedD1Client },
  action: sharedAction,
  schema: sharedSchema,
};

export const D1 = { shared };

export namespace D1 {
  export namespace shared {
    export type Client = SharedD1Client;
  }
}

export { DIAGNOSIS_CATALOG_ID } from "./shared/schema/catalog";
export type { DiagnosisDetail, DiagnosisDetailResult } from "./shared/action/catalog";
export type { IdentityProvider, LoginIdentityProvider } from "./shared/action/account";
