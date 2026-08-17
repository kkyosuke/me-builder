import { D1 } from "@me-builder/lib";
import type { Context, MiddlewareHandler } from "hono";
import * as v from "valibot";
import { isDevelopmentEnvironment } from "../config";
import {
  ServiceUnavailableErrorSchema,
  TermsAcceptanceRequiredErrorSchema,
} from "../contract/shared/errors";
import type { AppEnv } from "../types";
import { authenticatedActor } from "./authentication";

export type CurrentTermsChecker = (c: Context<AppEnv>, accountId: string) => Promise<boolean>;

const checkCurrentTerms: CurrentTermsChecker = async (c, accountId) => {
  if (!c.env?.DB) throw new Error("D1 binding is not configured");
  return D1.shared.action.agreement.hasAcceptedCurrentTerms(
    D1.shared.client.create(c.env.DB),
    accountId,
  );
};

/** 認証済みactorへ、現行利用規約への同意policyだけを適用する。 */
export function createCurrentTermsPolicyMiddleware(
  checker: CurrentTermsChecker = checkCurrentTerms,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.env?.DB) {
      return c.json(v.parse(ServiceUnavailableErrorSchema, { error: "Service Unavailable" }), 503);
    }
    const accepted = await checker(c, authenticatedActor(c).accountId);
    if (!accepted) {
      return c.json(
        v.parse(TermsAcceptanceRequiredErrorSchema, {
          error: "Terms acceptance required",
          reason: "terms_not_accepted",
        }),
        428,
      );
    }
    return next();
  };
}

export const requireCurrentTerms = createCurrentTermsPolicyMiddleware();

/** Productionでは開発用routeの存在自体を公開しない。 */
export const requireDevelopmentEnvironment: MiddlewareHandler<AppEnv> = async (c, next) => {
  const environment = c.env?.ENVIRONMENT?.trim();
  if (!environment || !isDevelopmentEnvironment(environment)) {
    return c.json({ error: "Not Found" } as const, 404);
  }
  return next();
};
