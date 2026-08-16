import { D1 } from "@me-builder/lib";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  ConfirmSelfCareContextRequestSchema,
  InvalidSelfCareContextSchema,
  SelfCareContextListSchema,
  SelfCareContextMutationSchema,
  SelfCareContextUnavailableSchema,
} from "../contract/profile/self-care-context";
import {
  AccountNotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
} from "../contract/shared/errors";
import {
  confirmSelfCareContext,
  getSelfCareContexts,
  revokeSelfCareContext,
} from "../logic/self-care-context";
import type { AppEnv } from "../types";
import { bearerToken } from "./auth";

function params(c: Context<AppEnv>) {
  if (!c.env?.DB || !c.env.ACCOUNT_DATA) return undefined;
  const config = getConfig(c.env);
  const db = D1.shared.client.create(c.env.DB);
  return {
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: config.lineLoginChannelId,
    db,
    accountData: c.env.ACCOUNT_DATA,
    planAssignmentProvider:
      c.env.ACCOUNT_PLAN_ASSIGNMENT_PROVIDER ??
      new D1.shared.action.billing.D1AccountPlanAssignmentProvider(db),
  };
}

function authError(c: Context<AppEnv>, type: string) {
  return type === "account-not-found"
    ? c.json(
        v.parse(AccountNotFoundErrorSchema, {
          error: "Account not found",
          reason: "friendship_required",
        }),
        404,
      )
    : c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
}

function unavailable(
  c: Context<AppEnv>,
  reason: v.InferInput<typeof SelfCareContextUnavailableSchema>["reason"],
) {
  return c.json(
    v.parse(SelfCareContextUnavailableSchema, {
      error: "Self-care context unavailable",
      reason,
    }),
    409,
  );
}

export async function getSelfCareContextContents(c: Context<AppEnv>): Promise<Response> {
  const input = params(c);
  if (!input) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await getSelfCareContexts(input);
  if (outcome.type !== "resolved") return authError(c, outcome.type);
  c.header("Cache-Control", "no-store");
  return c.json(v.parse(SelfCareContextListSchema, outcome));
}

export async function postSelfCareContextConfirmation(c: Context<AppEnv>): Promise<Response> {
  const input = params(c);
  if (!input) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const body = v.safeParse(
    ConfirmSelfCareContextRequestSchema,
    await c.req.json().catch(() => null),
  );
  if (!body.success) {
    return c.json(
      v.parse(InvalidSelfCareContextSchema, { error: "Invalid self-care context" }),
      400,
    );
  }
  const outcome = await confirmSelfCareContext({ ...input, ...body.output });
  if (outcome.type === "unavailable") return unavailable(c, outcome.reason);
  if (outcome.type !== "resolved") return authError(c, outcome.type);
  if (outcome.result.type !== "confirmed") {
    return unavailable(
      c,
      outcome.result.type === "brain-item-not-found" ? "brain_item_not_found" : "not_confirmed",
    );
  }
  return c.json(v.parse(SelfCareContextMutationSchema, { item: outcome.result.item }));
}

export async function deleteSelfCareContextConfirmation(c: Context<AppEnv>): Promise<Response> {
  const input = params(c);
  if (!input) {
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  }
  const outcome = await revokeSelfCareContext({
    ...input,
    id: c.req.param("selfCareContextId") ?? "",
  });
  if (outcome.type === "unavailable") return unavailable(c, outcome.reason);
  if (outcome.type !== "resolved") return authError(c, outcome.type);
  if (outcome.result.type !== "revoked") return unavailable(c, "brain_item_not_found");
  return c.json(v.parse(SelfCareContextMutationSchema, { item: outcome.result.item }));
}
