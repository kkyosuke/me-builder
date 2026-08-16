import { D1 } from "@me-builder/lib";
import type { Context, MiddlewareHandler } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import { ServiceUnavailableErrorSchema, UnauthorizedErrorSchema } from "../contract/shared/errors";
import { bearerToken } from "../controller/auth";
import { createLineCredentialVerifier } from "../infrastructure/authentication/line-credential-verifier";
import { authenticateLiff } from "../logic/authentication/authenticate-liff";
import type { AuthenticatedActor, AuthenticationResult } from "../logic/authentication/types";
import type { AppEnv } from "../types";

export type AuthenticationResolver = (c: Context<AppEnv>) => Promise<AuthenticationResult>;

async function resolveRequestAuthentication(c: Context<AppEnv>): Promise<AuthenticationResult> {
  if (!c.env?.DB) {
    return { type: "unauthenticated", reason: "authentication_not_configured" };
  }
  const config = getConfig(c.env);
  return authenticateLiff({
    idToken: bearerToken(c.req.header("authorization")),
    db: D1.shared.client.create(c.env.DB),
    verifier: createLineCredentialVerifier(config.lineLoginChannelId),
    adminLineUserIds: config.adminLineUserIds,
  });
}

/** 同じContextでは認証resolverを1度だけ実行し、後続middlewareとcontrollerへ共有する。 */
export function createAuthenticationMiddleware(
  resolver: AuthenticationResolver = resolveRequestAuthentication,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let result = c.get("authenticationResult");
    if (!result) {
      result = await resolver(c);
      c.set("authenticationResult", result);
      if (result.type === "authenticated") c.set("authenticatedActor", result.actor);
    }
    if (result.type === "authenticated") return next();
    if (result.reason === "authentication_not_configured") {
      return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
    }
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  };
}

export function authenticatedActor(c: Context<AppEnv>): AuthenticatedActor {
  const actor = c.get("authenticatedActor");
  if (!actor) throw new Error("Authentication middleware did not resolve an actor");
  return actor;
}

export const requireAuthentication = createAuthenticationMiddleware();
