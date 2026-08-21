/** 認証use caseが外部IdP実装へ要求するprovider非依存port。 */
export interface ExternalSsoProvider {
  createAuthorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<URL>;
  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    expectedNonce: string;
    /** linkではIdP側Identityの初回作成を許可し、公開loginでは既存Identityだけを許可する。 */
    identityProvisioning: "allow" | "existing-only";
  }): Promise<SsoVerifiedIdentity>;
}

/** adapter内で署名・claim検証を終えた後だけ生成できる外部Identity。 */
export type SsoVerifiedIdentity = {
  providerKey: string;
  subject: string;
  authenticationMethod: "sso";
  authenticatedAt: Date;
  displayProfile?: {
    displayName?: string;
    pictureUrl?: string;
  };
};

/** 現在利用するproviderをcomposition rootから各adapterへ渡すpolicy。 */
export type SsoIdentityProviderPolicy<ProviderKey extends string = string> = Readonly<{
  activeProviderKey: ProviderKey;
}>;

export class SsoProviderError extends Error {
  constructor(readonly reason: "configuration" | "provider_rejected" | "token_invalid") {
    super(`SSO provider failed: ${reason}`);
    this.name = "SsoProviderError";
  }
}
