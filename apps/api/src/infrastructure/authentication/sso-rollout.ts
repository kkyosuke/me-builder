import type { SsoRolloutAuthorizer } from "../../logic/authentication/sso-transaction";

/** 本人識別子を保存・出力せず、同じAccountを同じ割合bucketへ安定配置する。 */
export async function ssoRolloutBucket(accountId: string): Promise<number> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accountId));
  const prefix = new DataView(digest).getUint32(0, false);
  return prefix % 100;
}

/** 管理者は常時、一般Accountは設定割合だけをSSO session発行対象にする。 */
export function createSsoRolloutAuthorizer(percentage: number): SsoRolloutAuthorizer {
  if (!Number.isSafeInteger(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("SSO rollout percentage must be an integer from 0 to 100");
  }
  return {
    async allows(account) {
      if (account.role === "admin") return true;
      if (percentage === 0) return false;
      if (percentage === 100) return true;
      return (await ssoRolloutBucket(account.accountId)) < percentage;
    },
  };
}
