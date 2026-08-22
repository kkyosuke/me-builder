import { describe, expect, it, vi } from "vitest";
import { fetchAndVerifyClientMetadata, validateAuthorizationQuery } from "./mcp-oauth";

describe("MCP CIMD", () => {
  it.each([
    "http://example.com/client.json",
    "https://localhost/client.json",
    "https://127.0.0.1/client.json",
    "https://10.0.0.1/client.json",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/client.json",
    "https://[fd00::1]/client.json",
    "https://[fe80::1]/client.json",
    "https://[::ffff:127.0.0.1]/client.json",
  ])("公開HTTPS以外のmetadata URLをfetch前に拒否する: %s", async (clientId) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await fetchAndVerifyClientMetadata(clientId, fetcher)).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("client_idとredirect_uriをCIMDの完全一致で検証する", async () => {
    const clientId = "https://client.example/metadata.json";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          client_id: clientId,
          client_name: "Example Client",
          redirect_uris: ["https://client.example/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = await fetchAndVerifyClientMetadata(clientId, fetcher);
    expect(result).toMatchObject({
      clientId,
      clientName: "Example Client",
      redirectUris: ["https://client.example/callback"],
    });
    expect(result?.metadataHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fetcher).toHaveBeenCalledWith(
      new URL(clientId),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("対応外grantまたはclient secret認証を宣言するmetadataを拒否する", async () => {
    const clientId = "https://client.example/metadata.json";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          client_id: clientId,
          client_name: "Example Client",
          redirect_uris: ["https://client.example/callback"],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "client_secret_post",
        }),
      ),
    );
    expect(await fetchAndVerifyClientMetadata(clientId, fetcher)).toBeUndefined();
  });

  it("redirect応答と過大なmetadataを拒否する", async () => {
    const clientId = "https://client.example/metadata.json";
    const redirected = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { Location: "https://other.example" } }),
      );
    expect(await fetchAndVerifyClientMetadata(clientId, redirected)).toBeUndefined();
    const oversized = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { headers: { "Content-Length": String(33 * 1024) } }));
    expect(await fetchAndVerifyClientMetadata(clientId, oversized)).toBeUndefined();
  });
});

describe("MCP authorization query", () => {
  const resource = "https://mcp.example/mcp";
  it("Authorization Code + PKCE S256と固定resource/scopeだけを受理する", () => {
    const url = new URL("https://api.example/api/mcp/oauth/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: "https://client.example/metadata.json",
      redirect_uri: "https://client.example/callback",
      scope: "brain:search",
      resource,
      code_challenge_method: "S256",
      code_challenge: "a".repeat(43),
      state: "state-1",
    }).toString();
    expect(validateAuthorizationQuery(url, resource)).toEqual({
      clientId: "https://client.example/metadata.json",
      redirectUri: "https://client.example/callback",
      codeChallenge: "a".repeat(43),
      state: "state-1",
    });
    url.searchParams.set("resource", "https://other.example/mcp");
    expect(validateAuthorizationQuery(url, resource)).toBeUndefined();
  });
});
