import { publicBillingPlans } from "../packages/shared/src/billing/plan-catalog";

type ExpectedPlan = "free" | "lite" | "full" | "family";

export async function verifySubscriptionPreview(input: {
  apiBaseUrl: string;
  idToken?: string;
  expectedPlan?: ExpectedPlan;
  fetcher?: typeof fetch;
  projectionAttempts?: number;
  projectionPollIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<{ checks: string[]; plan?: ExpectedPlan; trialEligible?: boolean }> {
  const fetcher = input.fetcher ?? fetch;
  const apiBaseUrl = new URL(input.apiBaseUrl).origin;
  const checks: string[] = [];

  const health = await readJson(fetcher, new URL("/api/health", apiBaseUrl));
  if (!isRecord(health) || health.status !== "ok" || health.environment !== "preview") {
    throw new Error("Preview API health response does not identify the preview environment");
  }
  checks.push("api-health");

  const catalog = await readJson(fetcher, new URL("/api/billing/plans", apiBaseUrl));
  assertPublicCatalog(catalog);
  checks.push("public-plan-catalog");

  if (!input.idToken) {
    if (input.expectedPlan)
      throw new Error("PREVIEW_BILLING_ID_TOKEN is required with expectedPlan");
    return { checks };
  }

  const headers = { Authorization: `Bearer ${input.idToken}` };
  const trial = await readJson(
    fetcher,
    new URL("/api/billing/trial-eligibility", apiBaseUrl),
    headers,
  );
  if (!isRecord(trial) || typeof trial.eligible !== "boolean" || trial.trialDays !== 14) {
    throw new Error("Preview trial eligibility response is invalid");
  }
  const entitlement = await waitForEntitlementProjection({
    fetcher,
    url: new URL("/api/profile/entitlement", apiBaseUrl),
    headers,
    expectedPlan: input.expectedPlan,
    attempts: input.projectionAttempts ?? 20,
    intervalMs: input.projectionPollIntervalMs ?? 1_500,
    sleep:
      input.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
  });
  checks.push("account-trial-eligibility", "account-plan-projection");
  return { checks, plan: entitlement.plan, trialEligible: trial.eligible };
}

async function waitForEntitlementProjection(input: {
  fetcher: typeof fetch;
  url: URL;
  headers: Record<string, string>;
  expectedPlan?: ExpectedPlan;
  attempts: number;
  intervalMs: number;
  sleep: (milliseconds: number) => Promise<void>;
}): Promise<Record<string, unknown> & { plan: ExpectedPlan }> {
  for (let attempt = 0; attempt < input.attempts; attempt += 1) {
    const entitlement = await readJson(input.fetcher, input.url, input.headers);
    if (!isValidEntitlement(entitlement)) {
      throw new Error("Preview entitlement response is invalid");
    }
    if (!input.expectedPlan || entitlement.plan === input.expectedPlan) return entitlement;
    if (attempt + 1 < input.attempts) await input.sleep(input.intervalMs);
  }
  throw new Error(`Preview entitlement did not converge to expected plan ${input.expectedPlan}`);
}

function isValidEntitlement(
  value: unknown,
): value is Record<string, unknown> & { plan: ExpectedPlan } {
  if (
    !isRecord(value) ||
    !isPlan(value.plan) ||
    (value.status !== "free" && value.status !== "active" && value.status !== "safe-default") ||
    (value.source !== "free" && value.source !== "subscription" && value.source !== "family-seat")
  ) {
    return false;
  }
  if (value.plan === "free") {
    return value.source === "free" && (value.status === "free" || value.status === "safe-default");
  }
  return (
    value.status === "active" && (value.source === "subscription" || value.source === "family-seat")
  );
}

async function readJson(
  fetcher: typeof fetch,
  url: URL,
  headers?: Record<string, string>,
): Promise<unknown> {
  const response = await fetcher(url, headers ? { headers } : undefined);
  if (!response.ok)
    throw new Error(`Preview verification failed at ${url.pathname} (${response.status})`);
  return await response.json();
}

function assertPublicCatalog(value: unknown): void {
  if (!isRecord(value) || !Array.isArray(value.plans)) {
    throw new Error("Preview plan catalog response is invalid");
  }
  const expected = publicBillingPlans.map((plan) => ({
    code: plan.code,
    trialDays: plan.trialDays,
    prices: plan.prices.map(({ interval, amount, currency }) => ({ interval, amount, currency })),
  }));
  const actual = value.plans.map((plan) => {
    if (!isRecord(plan) || !Array.isArray(plan.prices)) {
      throw new Error("Preview plan catalog contains an invalid plan");
    }
    return {
      code: plan.code,
      trialDays: plan.trialDays,
      prices: plan.prices.map((price) => {
        if (!isRecord(price)) throw new Error("Preview plan catalog contains an invalid price");
        return { interval: price.interval, amount: price.amount, currency: price.currency };
      }),
    };
  });
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Preview plan catalog differs from the committed billing catalog");
  }
  if (/lookupKey|price_|productId/i.test(JSON.stringify(value))) {
    throw new Error("Preview plan catalog exposes provider identifiers");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlan(value: unknown): value is ExpectedPlan {
  return value === "free" || value === "lite" || value === "full" || value === "family";
}

if (import.meta.main) {
  const expectedPlan = process.env.PREVIEW_EXPECTED_PLAN?.trim();
  if (expectedPlan && !isPlan(expectedPlan)) throw new Error("PREVIEW_EXPECTED_PLAN is invalid");
  const result = await verifySubscriptionPreview({
    apiBaseUrl: process.env.PREVIEW_API_BASE_URL?.trim() || "https://api.stg.kagami.kyosuke.dev",
    ...(process.env.PREVIEW_BILLING_ID_TOKEN?.trim()
      ? { idToken: process.env.PREVIEW_BILLING_ID_TOKEN.trim() }
      : {}),
    ...(expectedPlan ? { expectedPlan } : {}),
  });
  console.info(JSON.stringify({ outcome: "succeeded", ...result }));
}
