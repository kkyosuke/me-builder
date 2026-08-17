import * as v from "valibot";

export const WebConfigSchema = v.object({
  environment: v.optional(v.string()),
  baseDomain: v.optional(v.string()),
  baseUrl: v.optional(v.string()),
  apiUrl: v.optional(v.string()),
  /** LINE Developers コンソールで発行した LIFF ID。未設定の場合 LIFF 初期化はスキップされます。 */
  liffId: v.optional(v.string()),
  /** APIと同じ外部ブラウザSSOの段階公開状態。 */
  ssoRolloutMode: v.optional(v.picklist(["disabled", "linking", "linked-login"]), "disabled"),
});

export type WebConfig = v.InferOutput<typeof WebConfigSchema>;
