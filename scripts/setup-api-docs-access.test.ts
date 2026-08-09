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
      .mockResolvedValueOnce(response([], { total_pages: 1 }))
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

    const policyRequest = fetchMock.mock.calls[3];
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
        response([{ id: "app-1", name: "me-builder-api-docs-production" }], {
          total_pages: 1,
        }),
      )
      .mockResolvedValueOnce(response({ id: "app-1", name: "me-builder-api-docs-production" }))
      .mockResolvedValueOnce(
        response(
          [
            {
              id: "policy-1",
              name: "Allow me-builder API docs developers",
              decision: "allow",
            },
          ],
          { total_pages: 1 },
        ),
      )
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
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("PUT");
  });

  it("未知のpolicyがある場合は安全側に停止する", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([{ id: "app-1", name: "me-builder-api-docs-production" }], {
          total_pages: 1,
        }),
      )
      .mockResolvedValueOnce(response({ id: "app-1", name: "me-builder-api-docs-production" }))
      .mockResolvedValueOnce(
        response([{ id: "policy-2", name: "Allow everyone", decision: "allow" }], {
          total_pages: 1,
        }),
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
  });
});
