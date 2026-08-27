import { describe, expect, it } from "vitest";
import { app } from "./app";
import { requireAuthentication } from "./middleware/authentication";
import { requireCurrentTerms } from "./middleware/authorization";

const unconsentedAuthenticatedAllowlist = [
  "DELETE /api/account",
  "DELETE /api/auth/session",
  "DELETE /api/auth/sso/identity",
  "GET /api/auth/session",
  "GET /api/auth/sso/identity",
  "GET /api/auth/sso/link-attempts/:attemptId",
  "GET /api/legal/terms",
  "GET /api/legal/terms/acceptances",
  "POST /api/account-recovery/complete",
  "POST /api/auth/sso/link",
  "POST /api/auth/sso/link-attempts/:attemptId/confirmation",
  "PUT /api/legal/terms/acceptance",
] as const;

type RegisteredRoute = (typeof app.routes)[number];

function routeKey(route: Pick<RegisteredRoute, "method" | "path">): string {
  return `${route.method} ${route.path}`;
}

function handlersByRoute(): Map<string, RegisteredRoute["handler"][]> {
  const routes = new Map<string, RegisteredRoute["handler"][]>();
  for (const route of app.routes) {
    const key = routeKey(route);
    routes.set(key, [...(routes.get(key) ?? []), route.handler]);
  }
  return routes;
}

describe("未同意時の直接API access matrix", () => {
  it("本人確認・Account解決・規約操作だけを同意gateから除外する", () => {
    const actualAllowlist: string[] = [];

    for (const [key, handlers] of handlersByRoute()) {
      const authenticationIndex = handlers.indexOf(requireAuthentication);
      if (authenticationIndex < 0) continue;

      const termsIndex = handlers.indexOf(requireCurrentTerms);
      if (termsIndex < 0) {
        actualAllowlist.push(key);
        continue;
      }
      expect(termsIndex, `${key} must authenticate before checking terms`).toBeGreaterThan(
        authenticationIndex,
      );
    }

    expect(actualAllowlist.sort()).toEqual([...unconsentedAuthenticatedAllowlist].sort());
  });

  it("allowlist外の全認証APIが428応答を契約へ公開する", async () => {
    const document = (await (await app.request("/api/openapi.json")).json()) as {
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    };

    for (const [key, handlers] of handlersByRoute()) {
      if (!handlers.includes(requireCurrentTerms)) continue;
      const separator = key.indexOf(" ");
      const method = key.slice(0, separator).toLowerCase();
      const path = key.slice(separator + 1).replace(/:([^/]+)/g, "{$1}");
      expect(
        document.paths[path]?.[method]?.responses?.["428"],
        `${key} must document the unconsented response`,
      ).toBeDefined();
    }
  });
});
