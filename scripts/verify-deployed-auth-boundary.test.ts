import { describe, expect, it, vi } from "vitest";
import { verifyDeployedAuthBoundary } from "./verify-deployed-auth-boundary";

const apiBaseUrl = "https://api.example.test";
const webOrigin = "https://web.example.test";
const cookieA = "__Host-me_builder_session=session-a";
const cookieB = "__Host-me_builder_session=session-b";

function cors() {
  return {
    "Access-Control-Allow-Origin": webOrigin,
    "Access-Control-Allow-Credentials": "true",
  };
}

function boundaryFetcher(): typeof fetch {
  let exchangeCount = 0;
  let activeCookie: string | undefined;
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const path = new URL(input.toString()).pathname;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const allowed = headers.get("Origin") === webOrigin;
    if (path === "/api/health") {
      return Response.json(
        { status: "ok", environment: "production" },
        allowed ? { headers: cors() } : undefined,
      );
    }
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors(), "Access-Control-Allow-Headers": "X-CSRF-Token" },
      });
    }
    if (path === "/api/auth/liff/exchange") {
      if (!allowed) return new Response(null, { status: 403 });
      exchangeCount += 1;
      activeCookie = exchangeCount === 1 ? cookieA : cookieB;
      return Response.json(
        { authenticated: true, csrfToken: `csrf-${exchangeCount}` },
        {
          headers: {
            ...cors(),
            "Cache-Control": "no-store",
            "Set-Cookie": `${activeCookie}; Path=/; HttpOnly; Secure; SameSite=Lax`,
          },
        },
      );
    }
    if (path === "/api/auth/session" && method === "DELETE") {
      if (
        !allowed ||
        headers.get("Cookie") !== activeCookie ||
        headers.get("X-CSRF-Token") !== `csrf-${exchangeCount}`
      ) {
        return new Response(null, { status: 403 });
      }
      activeCookie = undefined;
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": `${cookieB}; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
      });
    }
    if (path === "/api/auth/session") {
      return headers.get("Cookie") === activeCookie && activeCookie
        ? Response.json(
            { authenticated: true, csrfToken: `csrf-${exchangeCount}` },
            { headers: { ...cors(), "Cache-Control": "no-store" } },
          )
        : new Response(null, { status: 401, headers: cors() });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

describe("verifyDeployedAuthBoundary", () => {
  it("資格情報なしでProductionのOrigin/CORS/CSRF構成を検査する", async () => {
    const result = await verifyDeployedAuthBoundary({
      environment: "production",
      apiBaseUrl,
      webOrigin,
      fetcher: boundaryFetcher(),
    });
    expect(result.credentials).toBe("skipped");
    expect(result.checks).toContain("csrf-preflight");
    expect(result.checks).toContain("hostile-origin-exchange-denied");
  });

  it("短命LIFF credentialでCookie、切替、CSRF、logoutを検査する", async () => {
    const result = await verifyDeployedAuthBoundary({
      environment: "production",
      apiBaseUrl,
      webOrigin,
      liffIdTokenA: "short-lived-a",
      liffIdTokenB: "short-lived-b",
      confirmDisposableAccounts: true,
      fetcher: boundaryFetcher(),
    });
    expect(result.credentials).toBe("completed");
    expect(result.checks).toEqual(
      expect.arrayContaining(["session-cookie-attributes", "account-switch", "logout"]),
    );
    expect(JSON.stringify(result)).not.toContain("short-lived");
  });

  it("credential検査による全logoutには検証Accountの明示確認を要求する", async () => {
    await expect(
      verifyDeployedAuthBoundary({
        environment: "production",
        apiBaseUrl,
        webOrigin,
        liffIdTokenA: "short-lived-a",
        fetcher: boundaryFetcher(),
      }),
    ).rejects.toThrow("disposable Accounts confirmation");
  });

  it("Domain付きcookieを拒否する", async () => {
    const base = boundaryFetcher();
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const response = await base(input, init);
      if (new URL(input.toString()).pathname !== "/api/auth/liff/exchange" || !response.ok) {
        return response;
      }
      const headers = new Headers(response.headers);
      headers.set("Set-Cookie", `${headers.get("Set-Cookie")}; Domain=example.test`);
      return new Response(response.body, { status: response.status, headers });
    }) as typeof fetch;
    await expect(
      verifyDeployedAuthBoundary({
        environment: "production",
        apiBaseUrl,
        webOrigin,
        liffIdTokenA: "short-lived-a",
        confirmDisposableAccounts: true,
        fetcher,
      }),
    ).rejects.toThrow("host-only");
  });
});
