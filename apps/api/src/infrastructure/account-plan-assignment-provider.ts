import { D1, billing } from "@me-builder/lib";
import type { AppEnv } from "../types";

/** 明示したtest providerを優先し、実Planと環境別機能catalogを解決する。 */
export function accountPlanAssignmentProvider(
  env: AppEnv["Bindings"],
  db: D1.shared.Client,
): billing.AccountPlanAssignmentProvider {
  if (env.ACCOUNT_PLAN_ASSIGNMENT_PROVIDER) return env.ACCOUNT_PLAN_ASSIGNMENT_PROVIDER;
  return billing.accountPlanAssignmentProviderForEnvironment(
    env.ENVIRONMENT,
    new D1.shared.action.billing.D1AccountPlanAssignmentProvider(db),
    env.ENTITLEMENT_CATALOG,
  );
}
