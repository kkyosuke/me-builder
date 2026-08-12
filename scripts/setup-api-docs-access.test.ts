import { describe, expect, it, vi } from "vitest";
import {
  parseAllowedEmails,
  resolveApiHostname,
  setupApiDocsAccess,
} from "./setup-api-docs-access";

function response<T>(result: T, resultInfo?: { total_pages: number }): Response {
  return Response.json({ success: true, result, result_info: resultInfo });
}

describe("setup-api-docs-access", () => {
  it("許可メールアドレスを正規化し、重複を除く", () => {
    expect(parseAllowedEmails(" Dev@Example.com,dev@example.com, ops@example.com ")).toEqual([
      "dev@example.com",
      "ops@example.com",
    ]);
    expect(() => parseAllowedEmails("")).toThrow("at least one email");
    expect(() => parseAllowedEmails("invalid")).toThrow("Invalid email address");
  });

  it("BASE_DOMAINからAPIホスト名を解決する", () => {
    expect(resolveApiHostname("stg.example.com")).toBe("api.stg.example.com");
    expect(resolveApiHostname("https://api.example.com/")).toBe("api.example.com");
  });

  it("OpenAPIとSwagger UIだけを保護するApplicationとAllow policyを作成する", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([], { total_pages: 1 }))
      .mockResolvedValueOnce(response({ id: "app-1", name: "me-builder-api-docs-preview" }))
      .mockResolvedValueOnce(response({ id: "policy-1" }));

    await setupApiDocsAccess({
      environment: "preview",
      accountId: "account-1",
      apiToken: "token",
      baseDomain: "stg.example.com",
      allowedEmails: ["dev@example.com"],
      fetch: fetchMock,
    });

    const applicationRequest = fetchMock.mock.calls[1];
    expect(String(applicationRequest?.[0]).endsWith("/accounts/account-1/access/apps")).toBe(true);
    expect(applicationRequest?.[1]?.method).toBe("POST");
    const application = JSON.parse(String(applicationRequest?.[1]?.body));
    expect(application.destinations).toEqual([
      { type: "public", uri: "api.stg.example.com/api/openapi.json" },
      { type: "public", uri: "api.stg.example.com/api/docs" },
      { type: "public", uri: "api.stg.example.com/api/docs/*" },
    ]);
    expect(JSON.stringify(application)).not.toContain("/api/health");

    const policyRequest = fetchMock.mock.calls[2];
    expect(policyRequest?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(policyRequest?.[1]?.body))).toMatchObject({
      decision: "allow",
      include: [{ email: { email: "dev@example.com" } }],
    });
  });

  it("既存のApplicationとpolicyを更新する", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          [
            {
              id: "app-1",
              name: "me-builder-api-docs-production",
              policies: [
                {
                  id: "policy-1",
                  name: "Allow me-builder API docs developers",
                  decision: "allow",
                },
              ],
            },
          ],
          { total_pages: 1 },
        ),
      )
      .mockResolvedValueOnce(response({ id: "app-1", name: "me-builder-api-docs-production" }))
      .mockResolvedValueOnce(response({ id: "policy-1" }));

    await setupApiDocsAccess({
      environment: "production",
      accountId: "account-1",
      apiToken: "token",
      baseDomain: "example.com",
      allowedEmails: ["dev@example.com"],
      fetch: fetchMock,
    });

    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PUT");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("PUT");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/policies?page="))).toBe(
      false,
    );
  });

  it("同じ保護対象を持つ既存Applicationをpolicy検査後に引き継ぐ", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          [
            {
              id: "legacy-app",
              name: "Legacy API docs",
              domain: "api.stg.example.com/api/openapi.json",
              policies: [],
            },
          ],
          { total_pages: 1 },
        ),
      )
      .mockResolvedValueOnce(response({ id: "legacy-app", name: "me-builder-api-docs-preview" }))
      .mockResolvedValueOnce(response({ id: "policy-1" }));

    await setupApiDocsAccess({
      environment: "preview",
      accountId: "account-1",
      apiToken: "token",
      baseDomain: "stg.example.com",
      allowedEmails: ["dev@example.com"],
      fetch: fetchMock,
    });

    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PUT");
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/\/access\/apps\/legacy-app$/);
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("POST");
  });

  it("未知のpolicyがある場合は安全側に停止する", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response(
        [
          {
            id: "app-1",
            name: "me-builder-api-docs-production",
            policies: [{ id: "policy-2", name: "Allow everyone", decision: "allow" }],
          },
        ],
        { total_pages: 1 },
      ),
    );

    await expect(
      setupApiDocsAccess({
        environment: "production",
        accountId: "account-1",
        apiToken: "token",
        baseDomain: "example.com",
        allowedEmails: ["dev@example.com"],
        fetch: fetchMock,
      }),
    ).rejects.toThrow("Unmanaged policies exist");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Cloudflare APIのmessageが欠けていてもundefinedをエラーへ出さない", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([], { total_pages: 1 }))
      .mockResolvedValueOnce(
        Response.json({ success: false, errors: [{ code: 1010 }], result: null }, { status: 400 }),
      );

    await expect(
      setupApiDocsAccess({
        environment: "preview",
        accountId: "account-1",
        apiToken: "token",
        baseDomain: "stg.example.com",
        allowedEmails: ["dev@example.com"],
        fetch: fetchMock,
      }),
    ).rejects.toThrow(
      "Cloudflare API POST /access/apps failed (1010). Verify that the account's Zero Trust organization is initialized",
    );
  });

  it("埋め込みpolicyがない旧レスポンスで1010になった場合も必要な権限を案内する", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([{ id: "app-1", name: "me-builder-api-docs-preview" }], { total_pages: 1 }),
      )
      .mockResolvedValueOnce(
        Response.json({ success: false, errors: [{ code: 1010 }], result: null }, { status: 403 }),
      );

    await expect(
      setupApiDocsAccess({
        environment: "preview",
        accountId: "account-1",
        apiToken: "token",
        baseDomain: "stg.example.com",
        allowedEmails: ["dev@example.com"],
        fetch: fetchMock,
      }),
    ).rejects.toThrow(
      "Cloudflare API GET /access/apps/app-1/policies?page=1&per_page=50 failed (1010). Verify that the account's Zero Trust organization is initialized",
    );
  });
});
