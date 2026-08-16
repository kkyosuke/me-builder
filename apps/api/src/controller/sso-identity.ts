import { D1 } from "@me-builder/lib";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import { LastIdentityConflictSchema, SsoIdentityStatusSchema } from "../contract/auth/sso-identity";
import { ServiceUnavailableErrorSchema } from "../contract/shared/errors";
import { createAuth0SsoClient } from "../infrastructure/authentication/sso-client";
import {
  createSsoIdentityLinker,
  getSsoIdentityStatus,
  unlinkSsoIdentity,
} from "../infrastructure/authentication/sso-identity-repository";
import { createSsoTransactionStore } from "../infrastructure/authentication/sso-transaction-store";
import {
  cancelSsoIdentityLinking,
  completeSsoIdentityLinking,
  startSsoIdentityLinking,
} from "../logic/authentication/sso-transaction";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

function unavailable(c: Context<AppEnv>): Response {
  return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
}

function configured(c: Context<AppEnv>) {
  const configuration = getConfig(c.env);
  if (
    configuration.ssoRolloutMode === "disabled" ||
    !configuration.ssoIssuerUrl ||
    !configuration.ssoClientId ||
    !configuration.ssoClientSecret ||
    !configuration.ssoCallbackUrl ||
    !configuration.webOrigin ||
    !c.env?.SESSION_STORE
  ) {
    return undefined;
  }
  return {
    configuration,
    store: createSsoTransactionStore(c.env.SESSION_STORE),
    client: createAuth0SsoClient({
      issuerUrl: configuration.ssoIssuerUrl,
      clientId: configuration.ssoClientId,
      clientSecret: configuration.ssoClientSecret,
      callbackUrl: configuration.ssoCallbackUrl,
    }),
  };
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

export async function getSsoIdentityStatusContents(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (getConfig(c.env).ssoRolloutMode === "disabled" || !c.env?.DB) return unavailable(c);
  const status = await getSsoIdentityStatus(
    D1.shared.client.create(c.env.DB),
    authenticatedActor(c).accountId,
  );
  return c.json(v.parse(SsoIdentityStatusSchema, status));
}

export async function getSsoIdentityLink(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const dependencies = configured(c);
  if (!dependencies) return unavailable(c);
  const authorizationUrl = await startSsoIdentityLinking({
    initiatingAccountId: authenticatedActor(c).accountId,
    returnTo: c.req.query("returnTo") ?? "/profile",
    store: dependencies.store,
    client: dependencies.client,
  });
  return c.redirect(authorizationUrl.href, 302);
}

export async function getSsoCallback(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const dependencies = configured(c);
  if (!dependencies || !c.env?.DB) return unavailable(c);
  const state = c.req.query("state") ?? "";
  try {
    if (c.req.query("error")) {
      const cancelled = await cancelSsoIdentityLinking({ state, store: dependencies.store });
      return redirectToWeb(c, resultPath(cancelled.returnTo, "cancelled"));
    }
    const completed = await completeSsoIdentityLinking({
      state,
      code: c.req.query("code") ?? "",
      store: dependencies.store,
      client: dependencies.client,
      identityLinker: createSsoIdentityLinker(D1.shared.client.create(c.env.DB)),
    });
    return redirectToWeb(c, resultPath(completed.returnTo, "linked"));
  } catch {
    return redirectToWeb(c, "/profile?sso=error");
  }
}

export async function deleteSsoIdentity(c: Context<AppEnv>): Promise<Response> {
  c.header("Cache-Control", "no-store");
  if (getConfig(c.env).ssoRolloutMode === "disabled" || !c.env?.DB) return unavailable(c);
  try {
    await unlinkSsoIdentity(D1.shared.client.create(c.env.DB), authenticatedActor(c).accountId);
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
