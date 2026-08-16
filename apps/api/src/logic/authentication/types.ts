type AuthenticationMethod = "liff" | "sso";

/** Featureへ渡してよい、provider非依存の本人情報。 */
export type AuthenticatedActor = {
  accountId: string;
  authenticationMethod: AuthenticationMethod;
  authenticatedAt: Date;
};

/** 認証交換APIのresponse等へ載せてよい表示情報。本人識別には使わない。 */
type DisplayProfile = {
  displayName?: string;
  pictureUrl?: string;
};

type AuthenticationFailureReason =
  | "credential_missing"
  | "credential_invalid"
  | "authentication_not_configured";

export type AuthenticationResult =
  | {
      type: "authenticated";
      actor: AuthenticatedActor;
      accountRole: "user" | "admin";
      displayProfile?: DisplayProfile;
    }
  | { type: "unauthenticated"; reason: AuthenticationFailureReason };

/** 外部providerの検証済み結果。feature logicやHTTP responseへ渡さない。 */
type VerifiedExternalIdentity = {
  providerKey: string;
  subject: string;
  authenticationMethod: AuthenticationMethod;
  authenticatedAt: Date;
  displayProfile?: DisplayProfile;
};

export type CredentialVerificationResult =
  | { type: "verified"; identity: VerifiedExternalIdentity }
  | { type: "rejected"; reason: "credential_invalid" | "authentication_not_configured" };

export interface CredentialVerifier<Credential> {
  verify(credential: Credential): Promise<CredentialVerificationResult>;
}
