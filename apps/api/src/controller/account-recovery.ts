import { D1 } from "@me-builder/lib";
import type { Context } from "hono";
import * as v from "valibot";
import {
  AccountRecoveryCodeResponseSchema,
  AccountRecoveryCompleteRequestSchema,
  AccountRecoveryCompleteResponseSchema,
  AccountRecoveryUnavailableSchema,
} from "../contract/account-recovery";
import { ServiceUnavailableErrorSchema, UnauthorizedErrorSchema } from "../contract/shared/errors";
import { issueAccountRecoveryCode, recoverAccountWithCode } from "../logic/account-recovery";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

export async function postAccountRecoveryCode(c: Context<AppEnv>): Promise<Response> {
  if (!c.env?.DB)
    return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
  const outcome = await issueAccountRecoveryCode({
    actor: authenticatedActor(c),
    db: D1.shared.client.create(c.env.DB),
  });
  if (outcome.type === "issued") {
    c.header("Cache-Control", "no-store");
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
  const db = D1.shared.client.create(c.env.DB);
  const actor = authenticatedActor(c);
  const identity = await db.query.accountIdentities.findFirst({
    columns: { providerAccountId: true },
    where: (table, { and, eq }) =>
      and(
        eq(table.accountId, actor.accountId),
        eq(table.provider, "line_login"),
        eq(table.isDeleted, false),
      ),
  });
  if (!identity) {
    return c.json(v.parse(UnauthorizedErrorSchema, { error: "Unauthorized" }), 401);
  }
  const outcome = await recoverAccountWithCode({
    identity: { subject: identity.providerAccountId },
    sourceAccountId: actor.accountId,
    db,
    code: body.output.code,
    requestKey: c.req.header("cf-connecting-ip") ?? "unavailable",
  });
  switch (outcome.type) {
    case "recovered":
      c.header("Cache-Control", "no-store");
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
    case "rate-limited":
      return c.json(
        v.parse(AccountRecoveryUnavailableSchema, { error: "Too many recovery attempts" }),
        429,
      );
  }
}
