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
  now: () => Date = () => new Date(),
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
          authenticatedAt: now(),
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
