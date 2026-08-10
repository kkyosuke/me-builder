import * as sharedAction from "./shared/action";
import { type SharedD1Client, createSharedD1Client } from "./shared/client";
import * as sharedSchema from "./shared/schema";

/**
 * Cloudflare D1が保存するdatabase。
 *
 * 保存するのはAccount Identity、全Account共通の公開定義、原文を含まない集計projectionだけ。
 * Account所有データは`DO.account`が持つ。境界は
 * `docs/architecture/account-data-isolation.md`を正とする。
 */
export const D1 = {
  shared: {
    client: { create: createSharedD1Client },
    action: sharedAction,
    schema: sharedSchema,
  },
};

export namespace D1 {
  export namespace shared {
    export type Client = SharedD1Client;
  }
}

export { DIAGNOSIS_CATALOG_ID } from "./shared/schema/catalog";
export type { DiagnosisDetail, DiagnosisDetailResult } from "./shared/action/catalog";
