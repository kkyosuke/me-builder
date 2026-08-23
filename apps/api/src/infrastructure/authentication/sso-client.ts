import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import * as v from "valibot";
import type {
  ExternalSsoProvider,
  SsoVerifiedIdentity,
} from "../../logic/authentication/sso-provider";
import { SsoProviderError } from "../../logic/authentication/sso-provider";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;
const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const IDENTITY_PLATFORM_SIGN_IN_ENDPOINT =
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp";
const SSO_PROVIDER_TIMEOUT_MS = 5_000;
export const GOOGLE_CLOUD_IDENTITY_PLATFORM_PROVIDER_KEY = "gcp_identity_platform";

const GoogleTokenResponseSchema = v.object({
  id_token: v.pipe(v.string(), v.nonEmpty()),
});

const IdentityPlatformResponseSchema = v.object({
  localId: v.pipe(v.string(), v.nonEmpty()),
  providerId: v.literal("google.com"),
  tenantId: v.pipe(v.string(), v.nonEmpty()),
  isNewUser: v.optional(v.boolean(), false),
});

export type GoogleCloudIdentityPlatformSsoConfiguration = {
  identityPlatformApiKey: string;
  identityPlatformTenantId: string;
  googleClientId: string;
  googleClientSecret: string;
  callbackUrl: string;
};

type SsoFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function assertTrustedCallback(callbackUrl: string): void {
  const callback = new URL(callbackUrl);
  const loopbackHttp =
    callback.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname);
  if (
    (callback.protocol !== "https:" && !loopbackHttp) ||
    callback.username ||
    callback.password ||
    callback.pathname !== "/api/auth/sso/callback" ||
    callback.search ||
    callback.hash
  ) {
    throw new SsoProviderError("configuration");
  }
}

/** GoogleのOIDC証明をIdentity Platformの環境別userへ交換するserver-side client。 */
export function createGoogleCloudIdentityPlatformSsoClient(
  configuration: GoogleCloudIdentityPlatformSsoConfiguration,
  dependencies: {
    fetch?: SsoFetch;
    now?: () => Date;
  } = {},
): ExternalSsoProvider {
  if (
    !configuration.identityPlatformApiKey.trim() ||
    !configuration.identityPlatformTenantId.trim() ||
    !configuration.googleClientId.trim() ||
    !configuration.googleClientSecret.trim()
  ) {
    throw new SsoProviderError("configuration");
  }
  assertTrustedCallback(configuration.callbackUrl);

  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const remoteJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_ENDPOINT), {
    [customFetch]: fetcher,
    timeoutDuration: SSO_PROVIDER_TIMEOUT_MS,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60 * 1000,
  });

  async function verifyGoogleIdToken(
    token: string,
    expectedNonce: string,
  ): Promise<{
    authenticatedAt: Date;
    displayName?: string;
    pictureUrl?: string;
  }> {
    try {
      const { payload, protectedHeader } = await jwtVerify(token, remoteJwks, {
        issuer: [...GOOGLE_ISSUERS],
        audience: configuration.googleClientId,
        algorithms: ["RS256"],
        maxTokenAge: "10 minutes",
        clockTolerance: 5,
        ...(dependencies.now ? { currentDate: dependencies.now() } : {}),
      });
      if (
        protectedHeader.alg !== "RS256" ||
        payload.nonce !== expectedNonce ||
        !payload.sub ||
        !Number.isSafeInteger(payload.iat) ||
        (Array.isArray(payload.aud) &&
          payload.aud.length > 1 &&
          payload.azp !== configuration.googleClientId)
      ) {
        throw new SsoProviderError("token_invalid");
      }
      return {
        authenticatedAt: new Date((payload.iat as number) * 1000),
        ...(typeof payload.name === "string" ? { displayName: payload.name } : {}),
        ...(typeof payload.picture === "string" ? { pictureUrl: payload.picture } : {}),
      };
    } catch (error) {
      if (error instanceof SsoProviderError) throw error;
      throw new SsoProviderError("token_invalid");
    }
  }

  async function exchangeWithIdentityPlatform(
    googleIdToken: string,
    identityProvisioning: "allow" | "existing-only",
  ): Promise<string> {
    const endpoint = new URL(IDENTITY_PLATFORM_SIGN_IN_ENDPOINT);
    endpoint.searchParams.set("key", configuration.identityPlatformApiKey);
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestUri: configuration.callbackUrl,
          postBody: new URLSearchParams({
            id_token: googleIdToken,
            providerId: "google.com",
          }).toString(),
          returnSecureToken: true,
          returnIdpCredential: false,
          tenantId: configuration.identityPlatformTenantId,
          // linkは認証済みAccountへ接続するためIdentity Platform userの初回作成を許可する。
          // 公開loginでは既存userだけを許可し、未知userをIdentity Platformへ増やさない。
          ...(identityProvisioning === "existing-only" ? { autoCreate: false } : {}),
        }),
        signal: AbortSignal.timeout(SSO_PROVIDER_TIMEOUT_MS),
      });
    } catch {
      throw new SsoProviderError("provider_rejected");
    }
    if (!response.ok) throw new SsoProviderError("provider_rejected");
    try {
      const exchanged = v.parse(IdentityPlatformResponseSchema, await response.json());
      if (exchanged.tenantId !== configuration.identityPlatformTenantId) {
        throw new SsoProviderError("provider_rejected");
      }
      // existing-onlyでautoCreateが上流に無視されても、公開loginの未知userは拒否する。
      if (identityProvisioning === "existing-only" && exchanged.isNewUser) {
        throw new SsoProviderError("provider_rejected");
      }
      return exchanged.localId;
    } catch {
      throw new SsoProviderError("provider_rejected");
    }
  }

  return {
    async createAuthorizationUrl({ state, nonce, codeChallenge }) {
      const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: configuration.googleClientId,
        redirect_uri: configuration.callbackUrl,
        scope: "openid profile",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }).toString();
      return url;
    },

    async exchangeAuthorizationCode({ code, codeVerifier, expectedNonce, identityProvisioning }) {
      let response: Response;
      try {
        response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: configuration.googleClientId,
            client_secret: configuration.googleClientSecret,
            code,
            redirect_uri: configuration.callbackUrl,
            code_verifier: codeVerifier,
          }),
          signal: AbortSignal.timeout(SSO_PROVIDER_TIMEOUT_MS),
        });
      } catch {
        throw new SsoProviderError("provider_rejected");
      }
      if (!response.ok) throw new SsoProviderError("provider_rejected");

      let googleIdToken: string;
      try {
        googleIdToken = v.parse(GoogleTokenResponseSchema, await response.json()).id_token;
      } catch {
        throw new SsoProviderError("provider_rejected");
      }

      const googleIdentity = await verifyGoogleIdToken(googleIdToken, expectedNonce);
      const localId = await exchangeWithIdentityPlatform(googleIdToken, identityProvisioning);
      return {
        providerKey: GOOGLE_CLOUD_IDENTITY_PLATFORM_PROVIDER_KEY,
        subject: localId,
        authenticationMethod: "sso",
        authenticatedAt: googleIdentity.authenticatedAt,
        ...(googleIdentity.displayName || googleIdentity.pictureUrl
          ? {
              displayProfile: {
                ...(googleIdentity.displayName ? { displayName: googleIdentity.displayName } : {}),
                ...(googleIdentity.pictureUrl ? { pictureUrl: googleIdentity.pictureUrl } : {}),
              },
            }
          : {}),
      } satisfies SsoVerifiedIdentity;
    },
  };
}
