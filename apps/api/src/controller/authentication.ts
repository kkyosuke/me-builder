import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  ApplicationSessionResponseSchema,
  LiffAuthenticationExchangeRequestSchema,
} from "../contract/authentication";
import {
  ForbiddenErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import {
  APPLICATION_SESSION_COOKIE,
  createApplicationSessionService,
} from "../infrastructure/authentication/application-session-runtime";
import { createLineCredentialVerifier } from "../infrastructure/authentication/line-credential-verifier";
import { authenticateLiff } from "../logic/authentication/authenticate-liff";
import type { AuthenticationResult } from "../logic/authentication/types";
import { authenticatedSession } from "../middleware/authentication";
import type { AppEnv } from "../types";

export async function postLiffAuthenticationExchange(c: Context<AppEnv>): Promise<Response> {
  const config = getConfig(c.env);
  if (!config.webOrigin || c.req.header("Origin") !== config.webOrigin) {
    return c.json(v.parse(ForbiddenErrorSchema, { error: "Forbidden" }), 403);
  }
  const runtime = createApplicationSessionService(c.env);
  if (!runtime) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const body = v.safeParse(
    LiffAuthenticationExchangeRequestSchema,
    await c.req.json().catch(() => null),
  );
  if (!body.success) {
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
  const result = await authenticateLiff({
    idToken: body.output.idToken,
    db: runtime.db,
    verifier: createLineCredentialVerifier(config.lineLoginChannelId),
    adminLineUserIds: config.adminLineUserIds,
  });
  if (result.type !== "authenticated") {
    return result.reason === "authentication_not_configured"
      ? c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503)
      : c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
  const previousToken = getCookie(c, APPLICATION_SESSION_COOKIE);
  // logoutはD1 versionを進めるため、新sessionを発行した後に呼ぶと同じAccountの
  // 新sessionまで失効する。以前のsessionを先に失効してから現在versionで発行する。
  if (previousToken) await runtime.sessions.logout(previousToken);
  if (!result.authenticatedIdentityId) {
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
  const issued = await runtime.sessions.issue(
    result.actor,
    result.authenticatedIdentityId,
    result.displayProfile,
  );
  if (!issued) {
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
  setApplicationSessionCookie(c, issued.sessionToken, issued.expiresAt);
  c.header("Cache-Control", "no-store");
  return c.json(sessionResponse(result, issued));
}

export async function getApplicationSession(c: Context<AppEnv>): Promise<Response> {
  if (c.get("authenticationSource") !== "application-session") {
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
  const runtime = createApplicationSessionService(c.env);
  const sessionToken = c.get("applicationSessionToken");
  if (!runtime || !sessionToken) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const state = await runtime.sessions.clientState(sessionToken);
  if (!state) {
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
  c.header("Cache-Control", "no-store");
  return c.json(
    sessionResponse(authenticatedSession(c), {
      csrfToken: state.csrfToken,
      expiresAt: state.expiresAt,
    }),
  );
}

export async function deleteApplicationSession(c: Context<AppEnv>): Promise<Response> {
  if (c.get("authenticationSource") !== "application-session") {
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
  const runtime = createApplicationSessionService(c.env);
  if (!runtime) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  await runtime.sessions.logout(
    c.get("applicationSessionToken"),
    authenticatedSession(c).actor.accountId,
  );
  deleteCookie(c, APPLICATION_SESSION_COOKIE, {
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  });
  c.header("Cache-Control", "no-store");
  return c.body(null, 204);
}

function sessionResponse(
  authentication: Extract<AuthenticationResult, { type: "authenticated" }>,
  session: Readonly<{ csrfToken: string; expiresAt: Date }>,
) {
  return v.parse(ApplicationSessionResponseSchema, {
    authenticated: true,
    authenticationMethod: authentication.actor.authenticationMethod,
    authenticatedAt: authentication.actor.authenticatedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    csrfToken: session.csrfToken,
    role: authentication.accountRole,
    ...(authentication.displayProfile ? { displayProfile: authentication.displayProfile } : {}),
  });
}

export function setApplicationSessionCookie(
  c: Context<AppEnv>,
  token: string,
  expiresAt: Date,
): void {
  setCookie(c, APPLICATION_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
    maxAge: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1_000)),
  });
}
