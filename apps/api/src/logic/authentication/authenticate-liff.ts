import { D1 } from "@me-builder/lib";
import { resolveLineAccountRole } from "@me-builder/shared";
import type { LiffCredential } from "../../infrastructure/authentication/line-credential-verifier";
import type { AuthenticationResult, CredentialVerifier } from "./types";

type Params = {
  idToken: string | undefined;
  db: D1.shared.Client;
  verifier: CredentialVerifier<LiffCredential>;
  adminLineUserIds?: readonly string[];
};

/** LIFF credentialを検証し、provider情報を持たないactorへ正規化する。 */
export async function authenticateLiff({
  idToken,
  db,
  verifier,
  adminLineUserIds = [],
}: Params): Promise<AuthenticationResult> {
  if (!idToken) return { type: "unauthenticated", reason: "credential_missing" };
  const verification = await verifier.verify({ idToken });
  if (verification.type === "rejected") {
    return { type: "unauthenticated", reason: verification.reason };
  }
  const { identity } = verification;
  if (identity.providerKey !== "line_login" || identity.authenticationMethod !== "liff") {
    return { type: "unauthenticated", reason: "credential_invalid" };
  }
  const resolved = await D1.shared.action.account.resolveAccountByLineLogin(
    db,
    identity.subject,
    resolveLineAccountRole(identity.subject, adminLineUserIds),
  );
  if (identity.displayProfile?.displayName) {
    await D1.shared.action.profile.saveVerifiedDisplayName(
      db,
      resolved.account.id,
      identity.displayProfile.displayName,
    );
  }
  return {
    type: "authenticated",
    actor: {
      accountId: resolved.account.id,
      authenticationMethod: identity.authenticationMethod,
      authenticatedAt: identity.authenticatedAt,
    },
    accountRole: resolved.account.role,
    ...(identity.displayProfile ? { displayProfile: identity.displayProfile } : {}),
  };
}
