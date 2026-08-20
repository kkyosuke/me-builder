import { D1 } from "@me-builder/lib";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  ForbiddenErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import {
  APPLICATION_SESSION_COOKIE,
  CSRF_HEADER,
  createApplicationSessionService,
} from "../infrastructure/authentication/application-session-runtime";
import type { AuthenticatedActor, AuthenticationResult } from "../logic/authentication/types";
import type { AppEnv } from "../types";

export type AuthenticationResolver = (c: Context<AppEnv>) => Promise<AuthenticationResult>;

async function resolveRequestAuthentication(c: Context<AppEnv>): Promise<AuthenticationResult> {
  if (!c.env?.DB) {
    return { type: "unauthenticated", reason: "authentication_not_configured" };
  }
  const applicationSession = createApplicationSessionService(c.env);
  if (!applicationSession) {
    return { type: "unauthenticated", reason: "authentication_not_configured" };
  }
  const sessionToken = getCookie(c, APPLICATION_SESSION_COOKIE);
  if (!sessionToken) return { type: "unauthenticated", reason: "credential_missing" };

  const verified = await applicationSession.sessions.verify(sessionToken, {
    refreshIdle: ["GET", "HEAD", "OPTIONS"].includes(c.req.method),
  });
  if (!verified) return { type: "unauthenticated", reason: "credential_invalid" };

  const [account, profile] = await Promise.all([
    applicationSession.db.query.accounts.findFirst({
      columns: { role: true },
      where: (table, { eq }) => eq(table.id, verified.actor.accountId),
    }),
    applicationSession.db.query.accountProfiles.findFirst({
      columns: { displayName: true },
      where: (table, { eq }) => eq(table.accountId, verified.actor.accountId),
    }),
  ]);
  if (!account) return { type: "unauthenticated", reason: "credential_invalid" };
  const config = getConfig(c.env);
  if (
    config.environment === "production" &&
    account.role === "admin" &&
    !(await D1.shared.action.account.revokeAdminAccessUnlessAllowed(
      applicationSession.db,
      verified.actor.accountId,
      config.adminLineUserIds,
    ))
  ) {
    return { type: "unauthenticated", reason: "credential_invalid" };
  }

  c.set("authenticationSource", "application-session");
  c.set("applicationSessionToken", sessionToken);
  const displayName = profile?.displayName ?? verified.displayProfile?.displayName;
  const pictureUrl = verified.displayProfile?.pictureUrl;
  return {
    type: "authenticated",
    actor: verified.actor,
    accountRole: account.role,
    ...(verified.authenticatedIdentityId
      ? { authenticatedIdentityId: verified.authenticatedIdentityId }
      : {}),
    ...(displayName || pictureUrl
      ? {
          displayProfile: {
            ...(displayName ? { displayName } : {}),
            ...(pictureUrl ? { pictureUrl } : {}),
          },
        }
      : {}),
  };
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
    if (result.type === "authenticated") {
      if (!(await applicationSessionMutationAllowed(c))) {
        return c.json(v.parse(ForbiddenErrorSchema, { error: "Forbidden" }), 403);
      }
      return next();
    }
    if (result.reason === "authentication_not_configured") {
      return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
    }
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  };
}

async function applicationSessionMutationAllowed(c: Context<AppEnv>): Promise<boolean> {
  if (
    c.get("authenticationSource") !== "application-session" ||
    ["GET", "HEAD", "OPTIONS"].includes(c.req.method)
  ) {
    return true;
  }
  const expectedOrigin = getConfig(c.env).webOrigin;
  if (!expectedOrigin || c.req.header("Origin") !== expectedOrigin) return false;
  const runtime = createApplicationSessionService(c.env);
  const sessionToken = c.get("applicationSessionToken");
  if (!runtime || !sessionToken) return false;
  return await runtime.sessions.verifyCsrf(sessionToken, c.req.header(CSRF_HEADER), true);
}

export function authenticatedActor(c: Context<AppEnv>): AuthenticatedActor {
  const actor = c.get("authenticatedActor");
  if (!actor) throw new Error("Authentication middleware did not resolve an actor");
  return actor;
}

export function authenticatedSession(
  c: Context<AppEnv>,
): Extract<AuthenticationResult, { type: "authenticated" }> {
  const result = c.get("authenticationResult");
  if (result?.type !== "authenticated") {
    throw new Error("Authentication middleware did not resolve a session");
  }
  return result;
}

export const requireAuthentication = createAuthenticationMiddleware();
