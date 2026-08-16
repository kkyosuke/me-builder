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
import { bearerToken } from "../controller/auth";
import {
  APPLICATION_SESSION_COOKIE,
  CSRF_HEADER,
  createApplicationSessionService,
} from "../infrastructure/authentication/application-session-runtime";
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
  const authorization = c.req.header("authorization");
  // 移行中に明示されたBearerを古いcookieで上書きしない。不正なBearerでもcookieへ
  // fallbackせず、LIFFが確認したAccountをrequestの正とする。
  if (authorization !== undefined) {
    const result = await authenticateLiff({
      idToken: bearerToken(authorization),
      db: D1.shared.client.create(c.env.DB),
      verifier: createLineCredentialVerifier(config.lineLoginChannelId),
      adminLineUserIds: config.adminLineUserIds,
    });
    if (result.type === "authenticated") c.set("authenticationSource", "legacy-bearer");
    return result;
  }
  const applicationSession = createApplicationSessionService(c.env);
  const sessionToken = getCookie(c, APPLICATION_SESSION_COOKIE);
  if (applicationSession && sessionToken) {
    const actor = await applicationSession.sessions.verify(sessionToken, {
      refreshIdle: ["GET", "HEAD", "OPTIONS"].includes(c.req.method),
    });
    if (actor) {
      const [account, profile] = await Promise.all([
        applicationSession.db.query.accounts.findFirst({
          columns: { role: true },
          where: (table, { eq }) => eq(table.id, actor.accountId),
        }),
        applicationSession.db.query.accountProfiles.findFirst({
          columns: { displayName: true },
          where: (table, { eq }) => eq(table.accountId, actor.accountId),
        }),
      ]);
      if (account) {
        c.set("authenticationSource", "application-session");
        c.set("applicationSessionToken", sessionToken);
        return {
          type: "authenticated",
          actor,
          accountRole: account.role,
          ...(profile?.displayName ? { displayProfile: { displayName: profile.displayName } } : {}),
        };
      }
    }
  }
  return { type: "unauthenticated", reason: "credential_missing" };
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
