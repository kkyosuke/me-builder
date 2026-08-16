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
  if (url.protocol !== "https:" || url.origin !== issuer.origin) {
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
  if (issuer.protocol !== "https:" || issuer.pathname !== "/") {
    throw new SsoProviderError("configuration");
  }

  let discoveryPromise: Promise<OidcDiscovery> | undefined;
  let remoteJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

  async function discovery(): Promise<OidcDiscovery> {
    discoveryPromise ??= (async () => {
      const response = await fetcher(new URL(".well-known/openid-configuration", issuer));
      if (!response.ok) throw new SsoProviderError("configuration");
      const document = v.parse(DiscoverySchema, await response.json());
      if (document.issuer !== issuer.href) throw new SsoProviderError("configuration");
      assertTrustedEndpoint(issuer, document.authorization_endpoint);
      assertTrustedEndpoint(issuer, document.token_endpoint);
      assertTrustedEndpoint(issuer, document.jwks_uri);
      return document;
    })();
    return await discoveryPromise;
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
        });
        if (protectedHeader.alg !== "RS256" || payload.nonce !== expectedNonce || !payload.sub) {
          throw new SsoProviderError("token_invalid");
        }
        const displayName = typeof payload.name === "string" ? payload.name : undefined;
        const pictureUrl = typeof payload.picture === "string" ? payload.picture : undefined;
        return {
          providerKey: "auth0",
          subject: payload.sub,
          authenticationMethod: "sso",
          authenticatedAt: dependencies.now?.() ?? new Date(),
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
      const response = await fetcher(document.token_endpoint, {
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
      });
      if (!response.ok) throw new SsoProviderError("provider_rejected");
      const token = v.parse(TokenResponseSchema, await response.json()).id_token;
      return await verifyToken(token, document, expectedNonce);
    },
  };
}
