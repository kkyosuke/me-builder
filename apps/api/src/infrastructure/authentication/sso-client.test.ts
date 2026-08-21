import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import { SsoProviderError } from "../../logic/authentication/sso-provider";
import { createGoogleCloudIdentityPlatformSsoClient } from "./sso-client";

const configuration = {
  identityPlatformApiKey: "identity-platform-api-key",
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  callbackUrl: "https://api.example.com/api/auth/sso/callback",
};

async function googleToken(input: {
  nonce?: string;
  audience?: string | string[];
  azp?: string;
}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const issuedAtSeconds = Date.parse("2026-08-16T00:00:00.000Z") / 1000;
  const token = await new SignJWT({
    nonce: input.nonce ?? "expected-nonce",
    name: "Kagami User",
    picture: "https://images.example.com/user.png",
    email: "ignored@example.test",
    ...(input.azp ? { azp: input.azp } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://accounts.google.com")
    .setAudience(input.audience ?? configuration.googleClientId)
    .setSubject("google-subject-never-stored")
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime("5m")
    .sign(privateKey);
  return {
    token,
    jwks: { keys: [{ ...publicJwk, kid: "test-key", use: "sig" }] },
    issuedAtSeconds,
  };
}

describe("createGoogleCloudIdentityPlatformSsoClient", () => {
  it("Google Authorization Code Flow + PKCEの認可URLを作る", async () => {
    const fetcher = vi.fn();
    const client = createGoogleCloudIdentityPlatformSsoClient(configuration, { fetch: fetcher });

    const url = await client.createAuthorizationUrl({
      state: "state",
      nonce: "nonce",
      codeChallenge: "challenge",
    });

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: configuration.googleClientId,
      redirect_uri: configuration.callbackUrl,
      scope: "openid profile",
      state: "state",
      nonce: "nonce",
      code_challenge: "challenge",
      code_challenge_method: "S256",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("Google tokenを検証してIdentity Platform localIdだけをIdentityへ変換する", async () => {
    const signed = await googleToken({});
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.href === "https://oauth2.googleapis.com/token") {
        expect(init?.method).toBe("POST");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(new URLSearchParams(String(init?.body))).toEqual(
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: configuration.googleClientId,
            client_secret: configuration.googleClientSecret,
            code: "authorization-code",
            redirect_uri: configuration.callbackUrl,
            code_verifier: "verifier",
          }),
        );
        return Response.json({ id_token: signed.token });
      }
      if (url.href === "https://www.googleapis.com/oauth2/v3/certs") {
        return Response.json(signed.jwks);
      }
      if (url.origin === "https://identitytoolkit.googleapis.com") {
        expect(url.searchParams.get("key")).toBe(configuration.identityPlatformApiKey);
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          requestUri: configuration.callbackUrl,
          returnSecureToken: true,
          returnIdpCredential: false,
        });
        expect(new URLSearchParams(body.postBody)).toEqual(
          new URLSearchParams({ id_token: signed.token, providerId: "google.com" }),
        );
        return Response.json({ localId: "identity-platform-uid", providerId: "google.com" });
      }
      throw new Error(`unexpected URL: ${url.href}`);
    });
    const now = new Date("2026-08-16T00:01:00.000Z");
    const client = createGoogleCloudIdentityPlatformSsoClient(configuration, {
      fetch: fetcher,
      now: () => now,
    });

    await expect(
      client.exchangeAuthorizationCode({
        code: "authorization-code",
        codeVerifier: "verifier",
        expectedNonce: "expected-nonce",
      }),
    ).resolves.toEqual({
      providerKey: "gcp_identity_platform",
      subject: "identity-platform-uid",
      authenticationMethod: "sso",
      authenticatedAt: new Date(signed.issuedAtSeconds * 1000),
      displayProfile: {
        displayName: "Kagami User",
        pictureUrl: "https://images.example.com/user.png",
      },
    });
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("ignored@example.test");
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("google-subject-never-stored");
  });

  it("ID tokenのnonce改ざんを拒否しIdentity Platformを呼ばない", async () => {
    const signed = await googleToken({ nonce: "tampered" });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ id_token: signed.token });
      }
      if (url === "https://www.googleapis.com/oauth2/v3/certs") {
        return Response.json(signed.jwks);
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const client = createGoogleCloudIdentityPlatformSsoClient(configuration, {
      fetch: fetcher,
      now: () => new Date("2026-08-16T00:01:00.000Z"),
    });

    await expect(
      client.exchangeAuthorizationCode({
        code: "code",
        codeVerifier: "verifier",
        expectedNonce: "expected-nonce",
      }),
    ).rejects.toEqual(new SsoProviderError("token_invalid"));
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("identitytoolkit"))).toBe(false);
  });

  it("複数audienceでGoogle clientがauthorized partyでなければ拒否する", async () => {
    const signed = await googleToken({
      audience: [configuration.googleClientId, "another-audience"],
      azp: "another-client",
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "https://oauth2.googleapis.com/token"
        ? Response.json({ id_token: signed.token })
        : Response.json(signed.jwks),
    );
    const client = createGoogleCloudIdentityPlatformSsoClient(configuration, { fetch: fetcher });

    await expect(
      client.exchangeAuthorizationCode({
        code: "code",
        codeVerifier: "verifier",
        expectedNonce: "expected-nonce",
      }),
    ).rejects.toEqual(new SsoProviderError("token_invalid"));
  });

  it.each([
    { identityPlatformApiKey: "" },
    { googleClientId: "" },
    { googleClientSecret: "" },
    { callbackUrl: "javascript:alert(1)" },
    { callbackUrl: "http://api.example.com/api/auth/sso/callback" },
    { callbackUrl: "https://api.example.com/api/auth/sso/callback?next=/admin" },
    { callbackUrl: "https://api.example.com/another/callback" },
  ])("不完全または安全でない設定を拒否する: %o", (overrides) => {
    expect(() =>
      createGoogleCloudIdentityPlatformSsoClient({ ...configuration, ...overrides }),
    ).toThrowError(new SsoProviderError("configuration"));
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "local開発用loopback callbackのHTTPだけを許可する: %s",
    (hostname) => {
      expect(() =>
        createGoogleCloudIdentityPlatformSsoClient({
          ...configuration,
          callbackUrl: `http://${hostname}:8787/api/auth/sso/callback`,
        }),
      ).not.toThrow();
    },
  );

  it("Identity Platformがcredentialを拒否した場合は固定errorへ変換する", async () => {
    const signed = await googleToken({});
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ id_token: signed.token });
      }
      if (url === "https://www.googleapis.com/oauth2/v3/certs") {
        return Response.json(signed.jwks);
      }
      return Response.json({ error: { message: "CONFIGURATION_NOT_FOUND" } }, { status: 400 });
    });
    const client = createGoogleCloudIdentityPlatformSsoClient(configuration, {
      fetch: fetcher,
      now: () => new Date("2026-08-16T00:01:00.000Z"),
    });

    await expect(
      client.exchangeAuthorizationCode({
        code: "code",
        codeVerifier: "verifier",
        expectedNonce: "expected-nonce",
      }),
    ).rejects.toEqual(new SsoProviderError("provider_rejected"));
  });
});
