import { D1 } from "@me-builder/lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type McpServiceContext, beginMcpAuthorization, issueMcpTokens } from "./mcp-service";

const oauth = vi.hoisted(() => ({
  validateAuthorizationQuery: vi.fn(),
  fetchAndVerifyClientMetadata: vi.fn(),
}));

vi.mock("./mcp-oauth", () => oauth);

const context: McpServiceContext = {
  db: {} as D1.shared.Client,
  webOrigin: "https://web.example",
  resource: "https://mcp.example/mcp",
  secret: "test-secret",
};

afterEach(() => {
  vi.restoreAllMocks();
  oauth.validateAuthorizationQuery.mockReset();
  oauth.fetchAndVerifyClientMetadata.mockReset();
});

describe("MCP application service", () => {
  it("不正な認可requestではmetadata取得や永続化を行わない", async () => {
    oauth.validateAuthorizationQuery.mockReturnValue(undefined);
    const create = vi.spyOn(D1.shared.action.mcp, "createAuthorizationRequest");

    await expect(
      beginMcpAuthorization(context, "account-1", new URL("https://api.example/authorize")),
    ).resolves.toEqual({ type: "invalid-request" });
    expect(oauth.fetchAndVerifyClientMetadata).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("検証済みclientだけを認可確認画面へ渡す", async () => {
    oauth.validateAuthorizationQuery.mockReturnValue({
      clientId: "https://client.example/metadata.json",
      redirectUri: "https://client.example/callback",
      state: "state-1",
      codeChallenge: "challenge",
    });
    oauth.fetchAndVerifyClientMetadata.mockResolvedValue({
      clientId: "https://client.example/metadata.json",
      clientName: "Test client",
      metadataHash: "hash",
      redirectUris: ["https://client.example/callback"],
    });
    vi.spyOn(D1.shared.action.mcp, "createAuthorizationRequest").mockResolvedValue({
      id: "request-1",
    } as never);

    await expect(
      beginMcpAuthorization(context, "account-1", new URL("https://api.example/authorize")),
    ).resolves.toEqual({
      type: "created",
      redirectUrl: "https://web.example/mcp/authorize?request=request-1",
    });
  });

  it("token grantの入力不正をDB操作前に拒否する", async () => {
    const exchange = vi.spyOn(D1.shared.action.mcp, "exchangeAuthorizationCode");

    await expect(
      issueMcpTokens(context, {
        grant_type: "authorization_code",
        client_id: "client-1",
        code: "code",
        code_verifier: "short",
      }),
    ).resolves.toMatchObject({ type: "error", error: "invalid_grant" });
    expect(exchange).not.toHaveBeenCalled();
  });
});
