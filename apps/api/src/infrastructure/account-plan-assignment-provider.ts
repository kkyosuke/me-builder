import { D1, billing } from "@me-builder/lib";
import { getConfig } from "../config";
import type { AppEnv } from "../types";

/** 明示したtest providerを優先し、Localだけ全AccountをFullへ差し替える。 */
export function accountPlanAssignmentProvider(
  env: AppEnv["Bindings"],
  db: D1.shared.Client,
): billing.AccountPlanAssignmentProvider {
  if (env.ACCOUNT_PLAN_ASSIGNMENT_PROVIDER) return env.ACCOUNT_PLAN_ASSIGNMENT_PROVIDER;
  return billing.accountPlanAssignmentProviderForEnvironment(
    getConfig(env).environment,
    new D1.shared.action.billing.D1AccountPlanAssignmentProvider(db),
  );
}
