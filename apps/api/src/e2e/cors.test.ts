import { describe, expect, it } from "vitest";
import { app } from "../index";

const allowedOrigin = "https://stg.kagami.kyosuke.dev";

describe("API CORS E2E", () => {
  it("許可されたWebオリジンの通常リクエストにはAllow-Originを返す", async () => {
    const response = await app.request(
      "/api/health",
      { headers: { Origin: allowedOrigin } },
      { ENVIRONMENT: "preview", WEB_ORIGIN: allowedOrigin },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("未許可のWebオリジンの通常リクエストにはCORSヘッダを返さない", async () => {
    const response = await app.request(
      "/api/health",
      { headers: { Origin: "https://attacker.example" } },
      { ENVIRONMENT: "preview", WEB_ORIGIN: allowedOrigin },
    );

    expect(response.status).toBe(200);
    expect(
      [...response.headers.keys()].filter((name) => name.startsWith("access-control-")),
    ).toEqual([]);
  });

  it("許可されたWebオリジンのプリフライトでBearer認証用ヘッダを許可する", async () => {
    const response = await app.request(
      "/api/health",
      {
        method: "OPTIONS",
        headers: {
          Origin: allowedOrigin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "Authorization, Content-Type, X-CSRF-Token",
        },
      },
      { ENVIRONMENT: "preview", WEB_ORIGIN: allowedOrigin },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Authorization,Content-Type,X-CSRF-Token",
    );
  });

  it("未許可のオリジンにはCORSヘッダを返さない", async () => {
    const response = await app.request(
      "/api/health",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://attacker.example",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "Authorization, Content-Type",
        },
      },
      { ENVIRONMENT: "preview", WEB_ORIGIN: allowedOrigin },
    );

    expect(
      [...response.headers.keys()].filter((name) => name.startsWith("access-control-")),
    ).toEqual([]);
  });

  it("許可オリジンの設定がない場合もAccess-Control-Allow-Originを返さない", async () => {
    const response = await app.request("/api/health", {
      headers: { Origin: allowedOrigin },
    });

    expect(response.status).toBe(200);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("認証交換は未許可Originから実行しない", async () => {
    const response = await app.request(
      "/api/auth/liff/exchange",
      {
        method: "POST",
        headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: "provider-token" }),
      },
      { ENVIRONMENT: "preview", WEB_ORIGIN: allowedOrigin },
    );

    expect(response.status).toBe(403);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });
});
