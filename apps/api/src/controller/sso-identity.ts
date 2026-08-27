import { D1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  LastIdentityConflictSchema,
  SsoAuthorizationUrlSchema,
  SsoIdentityStatusSchema,
  SsoLinkAttemptConflictSchema,
  SsoLinkAttemptStatusSchema,
  SsoLinkAuthorizationUrlSchema,
} from "../contract/auth/sso-identity";
import { ServiceUnavailableErrorSchema } from "../contract/shared/errors";
import {
  APPLICATION_SESSION_COOKIE,
  createApplicationSessionService,
} from "../infrastructure/authentication/application-session-runtime";
import {
  createSsoExistingIdentityResolver,
  createSsoIdentityLinker,
  getSsoIdentityStatus,
  unlinkSsoIdentity,
} from "../infrastructure/authentication/sso-identity-repository";
import {
  createSsoLinkHandoffStore,
  hashSsoLinkSecret,
} from "../infrastructure/authentication/sso-link-handoff-store";
import {
  createConfiguredSsoProvider,
  ssoIdentityProviderPolicy,
} from "../infrastructure/authentication/sso-provider-runtime";
import { createSsoRolloutAuthorizer } from "../infrastructure/authentication/sso-rollout";
import { createSsoTransactionStore } from "../infrastructure/authentication/sso-transaction-store";
import { SsoProviderError } from "../logic/authentication/sso-provider";
import {
  SsoAuthenticationError,
  type SsoAuthenticationFailure,
  SsoCallbackCompletionError,
  cancelSsoAuthentication,
  completeSsoCallback,
  startSsoAuthentication,
  startSsoIdentityLinking,
} from "../logic/authentication/sso-transaction";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";
import { setApplicationSessionCookie } from "./authentication";

const SSO_CALLBACK_STATE_COOKIE = "me_builder_sso_callback_state";
const SECURE_SSO_CALLBACK_STATE_COOKIE = "__Host-me_builder_sso_callback_state";
const SSO_CALLBACK_STATE_TTL_SECONDS = 10 * 60;
const SSO_LINK_CONFIRMATION_HEADER = "X-SSO-Link-Confirmation";

const SSO_AUTHENTICATION_RESULT_CODES = {
  identity_unlinked: "SSO_IDENTITY_UNLINKED",
  invalid_callback: "SSO_INVALID_CALLBACK",
  invalid_return_to: "SSO_INVALID_RETURN_TO",
  transaction_expired: "SSO_TRANSACTION_EXPIRED",
  transaction_missing: "SSO_TRANSACTION_MISSING",
  transaction_purpose_mismatch: "SSO_TRANSACTION_PURPOSE_MISMATCH",
  rollout_excluded: "SSO_ROLLOUT_EXCLUDED",
} as const satisfies Record<SsoAuthenticationFailure, string>;

function callbackStateCookieOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "Lax" as const,
    maxAge: SSO_CALLBACK_STATE_TTL_SECONDS,
  };
}

function setCallbackStateCookie(
  c: Context<AppEnv>,
  authorizationUrl: URL,
  secure: boolean,
): boolean {
  const state = authorizationUrl.searchParams.get("state");
  if (!state) return false;
  const cookieName = secure ? SECURE_SSO_CALLBACK_STATE_COOKIE : SSO_CALLBACK_STATE_COOKIE;
  setCookie(c, cookieName, state, callbackStateCookieOptions(secure));
  return true;
}

function unavailable(c: Context<AppEnv>): Response {
  return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
}

function configured(c: Context<AppEnv>) {
  const configuration = getConfig(c.env);
  const client = createConfiguredSsoProvider(configuration);
  if (
    configuration.ssoRolloutMode === "disabled" ||
    !client ||
    !configuration.ssoCallbackUrl ||
    !configuration.webOrigin ||
    !c.env?.DB ||
    !c.env?.SESSION_STORE
  ) {
    return undefined;
  }
  const db = D1.shared.client.create(c.env.DB);
  return {
    configuration,
    secureCallback: new URL(configuration.ssoCallbackUrl).protocol === "https:",
    db,
    store: createSsoTransactionStore(db, c.env.SESSION_STORE),
    handoffs: createSsoLinkHandoffStore(db, c.env.SESSION_STORE),
    client,
  };
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function handoffCompletionPage(c: Context<AppEnv>, message: string): Response {
  c.header("Content-Type", "text/html; charset=UTF-8");
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  return c.body(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Google連携</title><body><main><h1>${message}</h1><p>この画面を閉じてLINEへ戻り、プロフィールで連携を確定してください。</p></main></body></html>`,
    200,
  );
}

function resultPath(returnTo: string, result: "cancelled" | "error" | "linked"): string {
  const url = new URL(returnTo, "https://return-to.invalid");
  url.searchParams.set("sso", result);
  return `${url.pathname}${url.search}${url.hash}`;
}

function redirectToWeb(c: Context<AppEnv>, path: string): Response {
  const origin = getConfig(c.env).webOrigin;
  if (!origin) return unavailable(c);
  return c.redirect(new URL(path, origin).href, 302);
}

function logSsoStarted(input: {
  traceId: string;
  purpose: "link" | "login";
  rolloutMode: "linking" | "linked-login";
}): void {
  logger.info(
    {
      event: "sso.authentication.started",
      service: "api",
      component: "sso",
      traceId: input.traceId,
      purpose: input.purpose,
      rolloutMode: input.rolloutMode,
      outcome: "succeeded",
      disposition: "provider-redirect",
      stage: "authorization.create",
    },
    "[SSO] succeeded at authorization.create -> provider-redirect",
  );
}

function logSsoStartFailure(input: { traceId: string; purpose: "link" | "login" }): void {
  logger.error(
    {
      event: "sso.authentication.failed",
      service: "api",
      component: "sso",
      traceId: input.traceId,
      purpose: input.purpose,
      outcome: "failed",
      disposition: "http-response",
      stage: "authorization.create",
      errorCode: "SSO_PROVIDER_UNAVAILABLE",
      errorCategory: "external",
      retryable: true,
    },
    "[SSO] failed at authorization.create -> http-response (SSO_PROVIDER_UNAVAILABLE, category:external)",
  );
}

function logSsoCallbackFailure(input: {
  traceId?: string;
  stage: "authorization.callback" | "callback.complete";
  errorCode: "SSO_PROVIDER_CALLBACK_FAILED" | "SSO_CALLBACK_FAILED";
  errorCategory: "external" | "unknown";
  retryable: boolean;
  resultCode?: (typeof SSO_AUTHENTICATION_RESULT_CODES)[SsoAuthenticationFailure];
}): void {
  logger.error(
    {
      event: "sso.callback.failed",
      service: "api",
      component: "sso",
      ...(input.traceId ? { traceId: input.traceId } : {}),
      outcome: "failed",
      disposition: "web-redirect",
      stage: input.stage,
      errorCode: input.errorCode,
      errorCategory: input.errorCategory,
      retryable: input.retryable,
      ...(input.resultCode ? { resultCode: input.resultCode } : {}),
    },
    `[SSO] failed at ${input.stage} -> web-redirect (${input.errorCode}, category:${input.errorCategory})`,
  );
}

export async function getSsoIdentityStatusContents(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (getConfig(c.env).ssoRolloutMode === "disabled" || !c.env?.DB) return unavailable(c);
  const status = await getSsoIdentityStatus(
    D1.shared.client.create(c.env.DB),
    authenticatedActor(c).accountId,
    ssoIdentityProviderPolicy,
  );
  return c.json(v.parse(SsoIdentityStatusSchema, status));
}

export async function postSsoIdentityLink(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const dependencies = configured(c);
  if (!dependencies) return unavailable(c);
  const traceId = crypto.randomUUID();
  const liffHandoff = c.req.query("handoff") === "liff";
  const attemptId = liffHandoff ? crypto.randomUUID() : undefined;
  const confirmationSecret = liffHandoff ? randomSecret() : undefined;
  const accountId = authenticatedActor(c).accountId;
  let authorizationUrl: URL;
  try {
    authorizationUrl = await startSsoIdentityLinking({
      traceId,
      initiatingAccountId: accountId,
      returnTo: c.req.query("returnTo") ?? "/profile",
      store: dependencies.store,
      client: dependencies.client,
      ...(attemptId && confirmationSecret
        ? {
            handoff: {
              attemptId,
              confirmationSecretHash: await hashSsoLinkSecret(confirmationSecret),
            },
          }
        : {}),
    });
  } catch (error) {
    if (!(error instanceof SsoProviderError)) throw error;
    logSsoStartFailure({ traceId, purpose: "link" });
    return unavailable(c);
  }
  if (!setCallbackStateCookie(c, authorizationUrl, dependencies.secureCallback)) {
    logSsoStartFailure({ traceId, purpose: "link" });
    return unavailable(c);
  }
  if (attemptId && confirmationSecret) {
    await dependencies.handoffs.put({
      attemptId,
      accountId,
      confirmationSecretHash: await hashSsoLinkSecret(confirmationSecret),
      expiresAt: Date.now() + SSO_CALLBACK_STATE_TTL_SECONDS * 1000,
      ttlSeconds: SSO_CALLBACK_STATE_TTL_SECONDS,
    });
  }
  logSsoStarted({
    traceId,
    purpose: "link",
    rolloutMode:
      dependencies.configuration.ssoRolloutMode === "linked-login" ? "linked-login" : "linking",
  });
  return c.json(
    v.parse(SsoLinkAuthorizationUrlSchema, {
      flow: attemptId && confirmationSecret ? "liff-handoff" : "same-browser",
      authorizationUrl: authorizationUrl.href,
      ...(attemptId && confirmationSecret ? { attemptId, confirmationSecret } : {}),
    }),
  );
}

export async function getSsoLinkAttempt(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const dependencies = configured(c);
  if (!dependencies) return unavailable(c);
  const status = await dependencies.handoffs.status({
    attemptId: c.req.param("attemptId") ?? "",
    accountId: authenticatedActor(c).accountId,
    confirmationSecret: c.req.header(SSO_LINK_CONFIRMATION_HEADER) ?? "",
  });
  return c.json(v.parse(SsoLinkAttemptStatusSchema, { status }));
}

export async function postSsoLinkAttemptConfirmation(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const dependencies = configured(c);
  const runtime = createApplicationSessionService(c.env);
  if (!dependencies || !runtime) return unavailable(c);
  const actor = authenticatedActor(c);
  const identity = await dependencies.handoffs.consumeReady({
    attemptId: c.req.param("attemptId") ?? "",
    accountId: actor.accountId,
    confirmationSecret: c.req.header(SSO_LINK_CONFIRMATION_HEADER) ?? "",
  });
  if (!identity) {
    return c.json(
      v.parse(SsoLinkAttemptConflictSchema, { error: "SSO link attempt cannot be confirmed" }),
      409,
    );
  }
  try {
    await createSsoIdentityLinker(runtime.db, ssoIdentityProviderPolicy).link({
      accountId: actor.accountId,
      providerKey: identity.providerKey,
      subject: identity.subject,
    });
  } catch (error) {
    if (error instanceof D1.shared.action.account.IdentityAlreadyLinkedError) {
      return c.json(
        v.parse(SsoLinkAttemptConflictSchema, { error: "SSO link attempt cannot be confirmed" }),
        409,
      );
    }
    throw error;
  }
  const status = await getSsoIdentityStatus(runtime.db, actor.accountId, ssoIdentityProviderPolicy);
  const previousToken = getCookie(c, APPLICATION_SESSION_COOKIE);
  if (!previousToken) return unavailable(c);
  const rotated = await runtime.sessions.rotate(previousToken);
  if (!rotated) return unavailable(c);
  setApplicationSessionCookie(c, rotated.sessionToken, rotated.expiresAt);
  return c.json(v.parse(SsoIdentityStatusSchema, status));
}

export async function postSsoLogin(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const dependencies = configured(c);
  if (!dependencies || dependencies.configuration.ssoRolloutMode !== "linked-login") {
    return unavailable(c);
  }
  const traceId = crypto.randomUUID();
  let authorizationUrl: URL;
  try {
    authorizationUrl = await startSsoAuthentication({
      traceId,
      returnTo: c.req.query("returnTo") ?? "/",
      store: dependencies.store,
      client: dependencies.client,
    });
  } catch (error) {
    if (!(error instanceof SsoProviderError)) throw error;
    logSsoStartFailure({ traceId, purpose: "login" });
    return unavailable(c);
  }
  if (!setCallbackStateCookie(c, authorizationUrl, dependencies.secureCallback)) {
    logSsoStartFailure({ traceId, purpose: "login" });
    return unavailable(c);
  }
  logSsoStarted({ traceId, purpose: "login", rolloutMode: "linked-login" });
  return c.json(
    v.parse(SsoAuthorizationUrlSchema, {
      flow: "same-browser",
      authorizationUrl: authorizationUrl.href,
    }),
  );
}

export async function getSsoCallback(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const dependencies = configured(c);
  if (!dependencies || !c.env?.DB) return unavailable(c);
  const state = c.req.query("state") ?? "";
  const cookieName = dependencies.secureCallback
    ? SECURE_SSO_CALLBACK_STATE_COOKIE
    : SSO_CALLBACK_STATE_COOKIE;
  const expectedState = getCookie(c, cookieName);
  deleteCookie(c, cookieName, callbackStateCookieOptions(dependencies.secureCallback));
  const isLiffHandoff = state.startsWith("liff.");
  if (!state || (!isLiffHandoff && state !== expectedState)) {
    logger.warn(
      {
        event: "sso.callback.rejected",
        service: "api",
        component: "sso",
        outcome: "discarded",
        disposition: "web-redirect",
        stage: "callback.bind",
        resultCode: "SSO_CALLBACK_STATE_MISMATCH",
      },
      "[SSO] discarded at callback.bind -> web-redirect (SSO_CALLBACK_STATE_MISMATCH)",
    );
    return redirectToWeb(c, "/profile?sso=error");
  }
  try {
    const providerError = c.req.query("error");
    if (providerError) {
      const cancelled = await cancelSsoAuthentication({ state, store: dependencies.store });
      if (cancelled.handoff) {
        const cancelledByUser = providerError === "access_denied";
        await dependencies.handoffs.mark(
          cancelled.handoff.attemptId,
          cancelledByUser ? "cancelled" : "failed",
        );
        return handoffCompletionPage(
          c,
          cancelledByUser ? "Google連携をキャンセルしました" : "Google連携を完了できませんでした",
        );
      }
      if (providerError !== "access_denied") {
        logSsoCallbackFailure({
          ...(cancelled.traceId ? { traceId: cancelled.traceId } : {}),
          stage: "authorization.callback",
          errorCode: "SSO_PROVIDER_CALLBACK_FAILED",
          errorCategory: "external",
          retryable:
            providerError === "server_error" || providerError === "temporarily_unavailable",
        });
        return redirectToWeb(c, resultPath(cancelled.returnTo, "error"));
      }
      logger.warn(
        {
          event: "sso.callback.cancelled",
          service: "api",
          component: "sso",
          ...(cancelled.traceId ? { traceId: cancelled.traceId } : {}),
          purpose: cancelled.purpose,
          outcome: "discarded",
          disposition: "web-redirect",
          stage: "authorization.callback",
          resultCode: "SSO_AUTHORIZATION_CANCELLED",
        },
        "[SSO] discarded at authorization.callback -> web-redirect (SSO_AUTHORIZATION_CANCELLED)",
      );
      return redirectToWeb(c, resultPath(cancelled.returnTo, "cancelled"));
    }
    const runtime = createApplicationSessionService(c.env);
    if (!runtime) return unavailable(c);
    const previousToken = getCookie(c, APPLICATION_SESSION_COOKIE);
    const completed = await completeSsoCallback({
      state,
      code: c.req.query("code") ?? "",
      store: dependencies.store,
      client: dependencies.client,
      identityResolver: createSsoExistingIdentityResolver(runtime.db, ssoIdentityProviderPolicy),
      identityLinker: createSsoIdentityLinker(runtime.db, ssoIdentityProviderPolicy),
      rolloutAuthorizer: createSsoRolloutAuthorizer(dependencies.configuration.ssoRolloutPercent),
      sessionIssuer: {
        async issue(actor) {
          // Account切替時は旧token自身のAccountを失効する。認証先Account IDを渡すと、
          // 別Accountのversionを進めて旧Accountの他tab sessionが残ってしまう。
          if (previousToken) await runtime.sessions.logout(previousToken);
          const issued = await runtime.sessions.issue(actor, actor.authenticatedIdentityId);
          if (!issued) throw new Error("Application session could not be issued");
          return issued;
        },
      },
      handoffStager: dependencies.handoffs.stager,
    });
    if (completed.purpose === "link-handoff") {
      return handoffCompletionPage(c, "Google認証が完了しました");
    }
    if (completed.purpose === "login") {
      setApplicationSessionCookie(c, completed.session.sessionToken, completed.session.expiresAt);
      logger.info(
        {
          event: "sso.callback.completed",
          service: "api",
          component: "sso",
          ...(completed.traceId ? { traceId: completed.traceId } : {}),
          purpose: "login",
          outcome: "succeeded",
          disposition: "web-redirect",
          stage: "session.issue",
        },
        "[SSO] succeeded at session.issue -> web-redirect",
      );
      return redirectToWeb(c, completed.returnTo);
    }
    if (previousToken) {
      await runtime.sessions.logout(previousToken);
    } else {
      await runtime.sessions.invalidateAccountSessions(completed.accountId);
    }
    const issued = await runtime.sessions.issue(
      {
        accountId: completed.accountId,
        authenticationMethod: completed.authenticationMethod,
        authenticatedAt: completed.authenticatedAt,
      },
      completed.authenticatedIdentityId,
    );
    if (!issued) return unavailable(c);
    setApplicationSessionCookie(c, issued.sessionToken, issued.expiresAt);
    logger.info(
      {
        event: "sso.callback.completed",
        service: "api",
        component: "sso",
        ...(completed.traceId ? { traceId: completed.traceId } : {}),
        purpose: "link",
        outcome: "succeeded",
        disposition: "web-redirect",
        stage: "identity.link",
      },
      "[SSO] succeeded at identity.link -> web-redirect",
    );
    return redirectToWeb(c, resultPath(completed.returnTo, "linked"));
  } catch (error) {
    const callback =
      error instanceof SsoAuthenticationError || error instanceof SsoCallbackCompletionError
        ? error.callback
        : undefined;
    const providerFailure =
      error instanceof SsoCallbackCompletionError && error.failure instanceof SsoProviderError;
    if (callback?.handoff) {
      await dependencies.handoffs.mark(callback.handoff.attemptId, "failed");
      return handoffCompletionPage(c, "Google連携を完了できませんでした");
    }
    logSsoCallbackFailure({
      ...(callback?.traceId ? { traceId: callback.traceId } : {}),
      stage: "callback.complete",
      errorCode: providerFailure ? "SSO_PROVIDER_CALLBACK_FAILED" : "SSO_CALLBACK_FAILED",
      errorCategory: providerFailure ? "external" : "unknown",
      retryable: providerFailure && error.failure.reason !== "token_invalid",
      ...(error instanceof SsoAuthenticationError
        ? { resultCode: SSO_AUTHENTICATION_RESULT_CODES[error.reason] }
        : {}),
    });
    return redirectToWeb(c, resultPath(callback?.returnTo ?? "/profile", "error"));
  }
}

export async function deleteSsoIdentity(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const runtime = createApplicationSessionService(c.env);
  if (getConfig(c.env).ssoRolloutMode === "disabled" || !runtime) return unavailable(c);
  const accountId = authenticatedActor(c).accountId;
  try {
    await unlinkSsoIdentity(runtime.db, accountId, ssoIdentityProviderPolicy);
    await runtime.sessions.invalidateAccountSessions(accountId);
    deleteCookie(c, APPLICATION_SESSION_COOKIE, {
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    });
    return c.body(null, 204);
  } catch (error) {
    if (error instanceof D1.shared.action.account.CannotUnlinkLastIdentityError) {
      return c.json(
        v.parse(LastIdentityConflictSchema, {
          error: "Last login identity cannot be unlinked",
        }),
        409,
      );
    }
    throw error;
  }
}
