import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import * as v from "valibot";
import type {
  SsoServerClient,
  SsoVerifiedIdentity,
} from "../../logic/authentication/sso-transaction";

const DiscoverySchema = v.object({
  issuer: v.pipe(v.string(), v.url()),
  authorization_endpoint: v.pipe(v.string(), v.url()),
  token_endpoint: v.pipe(v.string(), v.url()),
  jwks_uri: v.pipe(v.string(), v.url()),
});

const TokenResponseSchema = v.object({
  id_token: v.pipe(v.string(), v.nonEmpty()),
});

const SSO_PROVIDER_TIMEOUT_MS = 5_000;

type OidcDiscovery = v.InferOutput<typeof DiscoverySchema>;

export type Auth0SsoConfiguration = {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
};

export class SsoProviderError extends Error {
  constructor(readonly reason: "configuration" | "provider_rejected" | "token_invalid") {
    super(`SSO provider failed: ${reason}`);
    this.name = "SsoProviderError";
  }
}

type TokenVerifier = (
  token: string,
  discovery: OidcDiscovery,
  expectedNonce: string,
) => Promise<SsoVerifiedIdentity>;

type SsoFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function assertTrustedEndpoint(issuer: URL, endpoint: string): void {
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.origin !== issuer.origin ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new SsoProviderError("configuration");
  }
}

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

/** Auth0固有のendpointとtokenをadapter内に閉じ込めるOIDC server client。 */
export function createAuth0SsoClient(
  configuration: Auth0SsoConfiguration,
  dependencies: {
    fetch?: SsoFetch;
    now?: () => Date;
    verifyToken?: TokenVerifier;
  } = {},
): SsoServerClient {
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const issuer = new URL(configuration.issuerUrl);
  if (
    issuer.protocol !== "https:" ||
    issuer.pathname !== "/" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  ) {
    throw new SsoProviderError("configuration");
  }
  assertTrustedCallback(configuration.callbackUrl);

  let discoveryPromise: Promise<OidcDiscovery> | undefined;
  let remoteJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

  async function discovery(): Promise<OidcDiscovery> {
    const pending =
      discoveryPromise ??
      (async () => {
        try {
          const response = await fetcher(new URL(".well-known/openid-configuration", issuer), {
            signal: AbortSignal.timeout(SSO_PROVIDER_TIMEOUT_MS),
          });
          if (!response.ok) throw new SsoProviderError("configuration");
          const document = v.parse(DiscoverySchema, await response.json());
          if (document.issuer !== issuer.href) throw new SsoProviderError("configuration");
          assertTrustedEndpoint(issuer, document.authorization_endpoint);
          assertTrustedEndpoint(issuer, document.token_endpoint);
          assertTrustedEndpoint(issuer, document.jwks_uri);
          return document;
        } catch (error) {
          if (error instanceof SsoProviderError) throw error;
          throw new SsoProviderError("configuration");
        }
      })();
    discoveryPromise = pending;
    try {
      return await pending;
    } catch (error) {
      // 一時的な取得失敗をWorker isolateの生存期間中ずっと固定しない。
      if (discoveryPromise === pending) discoveryPromise = undefined;
      throw error;
    }
  }

  const verifyToken: TokenVerifier =
    dependencies.verifyToken ??
    (async (token, document, expectedNonce) => {
      remoteJwks ??= createRemoteJWKSet(new URL(document.jwks_uri), {
        [customFetch]: fetcher,
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60 * 1000,
      });
      try {
        const { payload, protectedHeader } = await jwtVerify(token, remoteJwks, {
          issuer: issuer.href,
          audience: configuration.clientId,
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
            payload.azp !== configuration.clientId)
        ) {
          throw new SsoProviderError("token_invalid");
        }
        const displayName = typeof payload.name === "string" ? payload.name : undefined;
        const pictureUrl = typeof payload.picture === "string" ? payload.picture : undefined;
        return {
          providerKey: "auth0",
          subject: payload.sub,
          authenticationMethod: "sso",
          authenticatedAt: new Date((payload.iat as number) * 1000),
          ...(displayName || pictureUrl
            ? {
                displayProfile: {
                  ...(displayName ? { displayName } : {}),
                  ...(pictureUrl ? { pictureUrl } : {}),
                },
              }
            : {}),
        };
      } catch (error) {
        if (error instanceof SsoProviderError) throw error;
        throw new SsoProviderError("token_invalid");
      }
    });

  return {
    async createAuthorizationUrl({ state, nonce, codeChallenge }) {
      const document = await discovery();
      const url = new URL(document.authorization_endpoint);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: configuration.clientId,
        redirect_uri: configuration.callbackUrl,
        scope: "openid profile",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }).toString();
      return url;
    },

    async exchangeAuthorizationCode({ code, codeVerifier, expectedNonce }) {
      const document = await discovery();
      let response: Response;
      try {
        response = await fetcher(document.token_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: configuration.clientId,
            client_secret: configuration.clientSecret,
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
      let token: string;
      try {
        token = v.parse(TokenResponseSchema, await response.json()).id_token;
      } catch {
        throw new SsoProviderError("provider_rejected");
      }
      return await verifyToken(token, document, expectedNonce);
    },
  };
}
