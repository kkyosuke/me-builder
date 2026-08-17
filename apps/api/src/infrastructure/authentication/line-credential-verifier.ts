import { line } from "@me-builder/lib";
import type {
  CredentialVerificationResult,
  CredentialVerifier,
} from "../../logic/authentication/types";

export type LiffCredential = {
  idToken: string;
};

export function createLineCredentialVerifier(
  lineLoginChannelId: string | undefined,
): CredentialVerifier<LiffCredential> {
  return {
    async verify({ idToken }): Promise<CredentialVerificationResult> {
      if (!lineLoginChannelId) {
        return { type: "rejected", reason: "authentication_not_configured" };
      }
      const verified = await line.idToken.verify({ idToken, channelId: lineLoginChannelId });
      if (!verified.ok) return { type: "rejected", reason: "credential_invalid" };
      return {
        type: "verified",
        identity: {
          providerKey: "line_login",
          subject: verified.claims.sub,
          authenticationMethod: "liff",
          // 再認証policyへ検証時刻を渡すと、古いcredentialの再送が新しい認証に
          // 見えてしまうため、LINEが返したiatを正とする。
          authenticatedAt: verified.claims.issuedAt,
          ...((verified.claims.name || verified.claims.picture) && {
            displayProfile: {
              ...(verified.claims.name ? { displayName: verified.claims.name } : {}),
              ...(verified.claims.picture ? { pictureUrl: verified.claims.picture } : {}),
            },
          }),
        },
      };
    },
  };
}
