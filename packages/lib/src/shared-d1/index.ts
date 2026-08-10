import * as action from "./action";
import { type SharedD1Client, createSharedD1Client } from "./client";
import * as schema from "./schema";

/** 共有D1: Account Identity、全Account共通の公開定義、原文を含まない集計projection。 */
export const sharedD1 = {
  client: {
    create: createSharedD1Client,
  },
  action,
  schema,
};

export namespace sharedD1 {
  export type Client = SharedD1Client;
}

export { createSharedD1Client } from "./client";
export type { SharedD1Client } from "./client";
export { DIAGNOSIS_CATALOG_ID } from "./schema/catalog";
export type { DiagnosisDetail, DiagnosisDetailResult } from "./action/catalog";
