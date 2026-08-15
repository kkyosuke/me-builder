import { D1 } from "@me-builder/lib";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import {
  AccountRecoveryCodeResponseSchema,
  AccountRecoveryCompleteRequestSchema,
  AccountRecoveryCompleteResponseSchema,
  AccountRecoveryUnavailableSchema,
} from "../contract/account-recovery";
import { ServiceUnavailableErrorSchema, UnauthorizedErrorSchema } from "../contract/shared/errors";
import { issueAccountRecoveryCode, recoverAccountWithCode } from "../logic/account-recovery";
import type { AppEnv } from "../types";
import { bearerToken } from "./auth";

export async function postAccountRecoveryCode(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB)
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  const outcome = await issueAccountRecoveryCode({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
  });
  if (outcome.type === "issued") {
    return c.json(v.parse(AccountRecoveryCodeResponseSchema, outcome), 201);
  }
  if (outcome.type === "paid-contract-required") {
    return c.json(
      v.parse(AccountRecoveryUnavailableSchema, { error: "Paid contract required" }),
      409,
    );
  }
  return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
}

export async function postAccountRecoveryComplete(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB)
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  const body = v.safeParse(
    AccountRecoveryCompleteRequestSchema,
    await c.req.json().catch(() => null),
  );
  if (!body.success) {
    return c.json(
      v.parse(AccountRecoveryUnavailableSchema, { error: "Invalid recovery code" }),
      400,
    );
  }
  const outcome = await recoverAccountWithCode({
    idToken: bearerToken(c.req.header("authorization")),
    lineLoginChannelId: getConfig(c.env).lineLoginChannelId,
    db: D1.shared.client.create(c.env.DB),
    code: body.output.code,
  });
  switch (outcome.type) {
    case "recovered":
      return c.json(
        v.parse(AccountRecoveryCompleteResponseSchema, {
          status: "recovered",
          alreadyRecovered: outcome.alreadyRecovered,
        }),
      );
    case "identity-conflict":
      return c.json(v.parse(AccountRecoveryUnavailableSchema, { error: "Identity conflict" }), 409);
    case "invalid-code":
      return c.json(
        v.parse(AccountRecoveryUnavailableSchema, { error: "Invalid recovery code" }),
        400,
      );
    case "unauthenticated":
      return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
}
