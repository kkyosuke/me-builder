import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import { SsoProviderError, createAuth0SsoClient } from "./sso-client";

const configuration = {
  issuerUrl: "https://tenant.auth0.com/",
  clientId: "client-id",
  clientSecret: "client-secret",
  callbackUrl: "https://api.example.com/api/auth/sso/callback",
};

const discovery = {
  issuer: configuration.issuerUrl,
  authorization_endpoint: "https://tenant.auth0.com/authorize",
  token_endpoint: "https://tenant.auth0.com/oauth/token",
  jwks_uri: "https://tenant.auth0.com/.well-known/jwks.json",
};

describe("createAuth0SsoClient", () => {
  it("discovery結果からAuthorization Code Flow + PKCEの認可URLを作る", async () => {
    const fetcher = vi.fn(async () => Response.json(discovery));
    const client = createAuth0SsoClient(configuration, { fetch: fetcher });

    const url = await client.createAuthorizationUrl({
      state: "state",
      nonce: "nonce",
      codeChallenge: "challenge",
    });

    expect(url.origin + url.pathname).toBe("https://tenant.auth0.com/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client-id",
      redirect_uri: configuration.callbackUrl,
      scope: "openid profile",
      state: "state",
      nonce: "nonce",
      code_challenge: "challenge",
      code_challenge_method: "S256",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("authorization codeをserver-sideで交換し、検証済みidentityを返す", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("openid-configuration")) return Response.json(discovery);
      if (url.endsWith("/oauth/token")) {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
        expect(new URLSearchParams(String(init?.body))).toEqual(
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: "client-id",
            client_secret: "client-secret",
            code: "authorization-code",
            redirect_uri: configuration.callbackUrl,
            code_verifier: "verifier",
          }),
        );
        return Response.json({ id_token: "id-token" });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const verifyToken = vi.fn(async () => ({
      providerKey: "auth0" as const,
      subject: "auth0|user-1",
      authenticationMethod: "sso" as const,
      authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
    }));
    const client = createAuth0SsoClient(configuration, { fetch: fetcher, verifyToken });

    await expect(
      client.exchangeAuthorizationCode({
        code: "authorization-code",
        codeVerifier: "verifier",
        expectedNonce: "nonce",
      }),
    ).resolves.toEqual(expect.objectContaining({ subject: "auth0|user-1" }));
    expect(verifyToken).toHaveBeenCalledWith("id-token", discovery, "nonce");
  });

  it("RS256署名・issuer・audience・nonceを検証してAuth0 identityへ変換する", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    const token = await new SignJWT({
      nonce: "expected-nonce",
      name: "Kagami User",
      picture: "https://images.example.com/user.png",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(configuration.issuerUrl)
      .setAudience(configuration.clientId)
      .setSubject("auth0|user-1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("openid-configuration")) return Response.json(discovery);
      if (url.endsWith("/oauth/token")) return Response.json({ id_token: token });
      if (url.endsWith("/.well-known/jwks.json")) {
        return Response.json({ keys: [{ ...publicJwk, kid: "test-key", use: "sig" }] });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const now = new Date("2026-08-16T00:00:00.000Z");
    const client = createAuth0SsoClient(configuration, { fetch: fetcher, now: () => now });

    await expect(
      client.exchangeAuthorizationCode({
        code: "code",
        codeVerifier: "verifier",
        expectedNonce: "expected-nonce",
      }),
    ).resolves.toEqual({
      providerKey: "auth0",
      subject: "auth0|user-1",
      authenticationMethod: "sso",
      authenticatedAt: now,
      displayProfile: {
        displayName: "Kagami User",
        pictureUrl: "https://images.example.com/user.png",
      },
    });
  });

  it("ID tokenのnonce改ざんを拒否する", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    const token = await new SignJWT({ nonce: "tampered" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(configuration.issuerUrl)
      .setAudience(configuration.clientId)
      .setSubject("auth0|user-1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("openid-configuration")) return Response.json(discovery);
      if (url.endsWith("/oauth/token")) return Response.json({ id_token: token });
      return Response.json({ keys: [{ ...publicJwk, kid: "test-key", use: "sig" }] });
    });
    const client = createAuth0SsoClient(configuration, { fetch: fetcher });

    await expect(
      client.exchangeAuthorizationCode({
        code: "code",
        codeVerifier: "verifier",
        expectedNonce: "expected-nonce",
      }),
    ).rejects.toEqual(new SsoProviderError("token_invalid"));
  });

  it("issuerと異なるoriginのendpointを含むdiscoveryを拒否する", async () => {
    const client = createAuth0SsoClient(configuration, {
      fetch: vi.fn(async () =>
        Response.json({ ...discovery, token_endpoint: "https://evil.example/oauth/token" }),
      ),
    });

    await expect(
      client.createAuthorizationUrl({ state: "state", nonce: "nonce", codeChallenge: "challenge" }),
    ).rejects.toEqual(new SsoProviderError("configuration"));
  });

  it("providerがcode交換を拒否した場合は内容を露出しない固定errorを返す", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      return String(input).endsWith("openid-configuration")
        ? Response.json(discovery)
        : Response.json(
            { error: "invalid_grant", error_description: "secret detail" },
            { status: 401 },
          );
    });
    const client = createAuth0SsoClient(configuration, { fetch: fetcher });

    await expect(
      client.exchangeAuthorizationCode({
        code: "code",
        codeVerifier: "verifier",
        expectedNonce: "nonce",
      }),
    ).rejects.toEqual(new SsoProviderError("provider_rejected"));
  });
});
