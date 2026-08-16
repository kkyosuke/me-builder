import {
  BILLING_INITIAL_TRIAL_DAYS,
  type BillingInterval,
  type PaidPlanCode,
} from "@me-builder/shared";
import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { OperationError, ValidationError } from "../../../infrastructure/errors";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { BillingPlan } from "../model/billing-plan";

type PlanCatalogResponse =
  operations["getBillingPlanCatalog"]["responses"][200]["content"]["application/json"];
const BillingPlanSchema = v.object({
  code: v.picklist(["lite", "full", "family"]),
  name: v.string(),
  description: v.string(),
  highlights: v.array(v.string()),
  trialDays: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
  prices: v.array(
    v.object({
      interval: v.picklist(["month", "year"]),
      amount: v.pipe(v.number(), v.integer(), v.minValue(1)),
      currency: v.literal("JPY"),
    }),
  ),
});
const PlanCatalogResponseSchema = v.object({
  plans: v.array(BillingPlanSchema),
}) satisfies v.GenericSchema<PlanCatalogResponse>;

type PortalResponse =
  operations["createBillingPortalSession"]["responses"][201]["content"]["application/json"];
const PortalResponseSchema = v.object({
  url: v.pipe(v.string(), v.url()),
}) satisfies v.GenericSchema<PortalResponse>;

export async function fetchBillingPlanCatalog(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<readonly BillingPlan[]> {
  let response: Response;
  try {
    response = await createHttpClient(apiUrl).request("/api/billing/plans", {
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OperationError("料金プランを取得できませんでした。時間をおいて再試行してください。", {
      code: "BILLING_PLAN_CATALOG_NETWORK_FAILED",
      cause: error,
    });
  }
  if (!response.ok) {
    throw new OperationError("料金プランを取得できませんでした。時間をおいて再試行してください。", {
      code: "BILLING_PLAN_CATALOG_FAILED",
      status: response.status,
    });
  }
  try {
    return v.parse(PlanCatalogResponseSchema, await response.json()).plans;
  } catch (error) {
    throw new ValidationError("料金プランの応答を確認できませんでした。", {
      code: "BILLING_PLAN_CATALOG_RESPONSE_INVALID",
      status: response.status,
      cause: error,
    });
  }
}

export async function fetchBillingTrialEligibility(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<boolean> {
  let response: Response;
  try {
    response = await createHttpClient(apiUrl).request("/api/billing/trial-eligibility", {
      headers: { Authorization: `Bearer ${idToken}` },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OperationError("トライアルの利用可否を取得できませんでした。", {
      code: "BILLING_TRIAL_ELIGIBILITY_NETWORK_FAILED",
      cause: error,
    });
  }
  if (!response.ok) {
    throw new OperationError("トライアルの利用可否を取得できませんでした。", {
      code: "BILLING_TRIAL_ELIGIBILITY_FAILED",
      status: response.status,
    });
  }
  try {
    return v.parse(
      v.object({
        eligible: v.boolean(),
        trialDays: v.literal(BILLING_INITIAL_TRIAL_DAYS),
      }),
      await response.json(),
    ).eligible;
  } catch (error) {
    throw new ValidationError("トライアル利用可否の応答を確認できませんでした。", {
      code: "BILLING_TRIAL_ELIGIBILITY_RESPONSE_INVALID",
      status: response.status,
      cause: error,
    });
  }
}

type CheckoutRequest = Readonly<{ plan: PaidPlanCode; interval: BillingInterval }>;

export async function createCheckoutSession(
  apiUrl: string | undefined,
  idToken: string,
  input: CheckoutRequest,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await createHttpClient(apiUrl).request("/api/billing/checkout-sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OperationError("購入手続きを開始できませんでした。時間をおいて再試行してください。", {
      code: "BILLING_CHECKOUT_NETWORK_FAILED",
      cause: error,
    });
  }
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { reason?: string } | null;
    const message =
      body?.reason === "existing_subscription"
        ? "現在の契約があります。契約管理から確認してください。"
        : body?.reason === "family_seat_active"
          ? "ファミリーパックに参加中です。個人契約を購入するには、先にファミリー席から退出してください。"
          : body?.reason === "checkout_in_progress"
            ? "すでに購入手続きが進行中です。開いているStripe画面を確認してください。"
            : "このプランは現在購入できません。";
    throw new OperationError(message, { code: "BILLING_CHECKOUT_UNAVAILABLE", status: 409 });
  }
  if (!response.ok) {
    throw new OperationError("購入手続きを開始できませんでした。時間をおいて再試行してください。", {
      code: "BILLING_CHECKOUT_FAILED",
      status: response.status,
    });
  }
  try {
    return v.parse(PortalResponseSchema, await response.json()).url;
  } catch (error) {
    throw new ValidationError("購入手続きの応答を確認できませんでした。", {
      code: "BILLING_CHECKOUT_RESPONSE_INVALID",
      status: response.status,
      cause: error,
    });
  }
}

export async function createPlanChangeSession(
  apiUrl: string | undefined,
  idToken: string,
  input: CheckoutRequest,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await createHttpClient(apiUrl).request("/api/billing/plan-change-sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OperationError("プラン変更を開始できませんでした。時間をおいて再試行してください。", {
      code: "BILLING_PLAN_CHANGE_NETWORK_FAILED",
      cause: error,
    });
  }
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { reason?: string } | null;
    const changeMessage =
      body?.reason === "same_plan"
        ? "現在と同じプラン・支払い間隔です。"
        : body?.reason === "configuration_missing"
          ? "年額への変更準備が完了していません。時間をおいて再試行してください。"
          : "現在の契約ではこのプランへ変更できません。";
    throw new OperationError(changeMessage, {
      code: "BILLING_PLAN_CHANGE_UNAVAILABLE",
      status: 409,
    });
  }
  if (!response.ok) {
    throw new OperationError("プラン変更を開始できませんでした。時間をおいて再試行してください。", {
      code: "BILLING_PLAN_CHANGE_FAILED",
      status: response.status,
    });
  }
  try {
    return v.parse(PortalResponseSchema, await response.json()).url;
  } catch (error) {
    throw new ValidationError("プラン変更の応答を確認できませんでした。", {
      code: "BILLING_PLAN_CHANGE_RESPONSE_INVALID",
      status: response.status,
      cause: error,
    });
  }
}

export async function verifyCheckoutSessionCompletion(
  apiUrl: string | undefined,
  idToken: string,
  checkoutSessionId: string,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await createHttpClient(apiUrl).request(
      `/api/billing/checkout-sessions/${encodeURIComponent(checkoutSessionId)}`,
      {
        headers: { Authorization: `Bearer ${idToken}` },
        ...(signal ? { signal } : {}),
      },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OperationError("購入結果を確認できませんでした。時間をおいて再試行してください。", {
      code: "BILLING_CHECKOUT_STATUS_NETWORK_FAILED",
      cause: error,
    });
  }
  if (!response.ok) {
    throw new OperationError("購入結果を確認できませんでした。料金プランからやり直してください。", {
      code: "BILLING_CHECKOUT_STATUS_FAILED",
      status: response.status,
    });
  }
  const parsed = v.safeParse(
    v.object({ status: v.picklist(["open", "complete", "expired"]) }),
    await response.json().catch(() => null),
  );
  if (!parsed.success) {
    throw new ValidationError("購入結果の応答を確認できませんでした。", {
      code: "BILLING_CHECKOUT_STATUS_RESPONSE_INVALID",
      status: response.status,
    });
  }
  if (parsed.output.status !== "complete") {
    throw new OperationError("購入手続きが完了していません。料金プランからやり直してください。", {
      code: "BILLING_CHECKOUT_NOT_COMPLETE",
      status: 409,
    });
  }
}

export async function createCustomerPortalSession(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await createHttpClient(apiUrl).request("/api/billing/portal-sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OperationError("契約管理を開けませんでした。時間をおいて再試行してください。", {
      code: "BILLING_PORTAL_NETWORK_FAILED",
      cause: error,
    });
  }
  if (response.status === 409) {
    throw new OperationError("管理できる契約がまだありません。契約反映後に再試行してください。", {
      code: "BILLING_CUSTOMER_NOT_FOUND",
      status: response.status,
    });
  }
  if (!response.ok) {
    throw new OperationError("契約管理を開けませんでした。時間をおいて再試行してください。", {
      code: "BILLING_PORTAL_FAILED",
      status: response.status,
    });
  }
  try {
    return v.parse(PortalResponseSchema, await response.json()).url;
  } catch (error) {
    throw new ValidationError("契約管理の応答を確認できませんでした。", {
      code: "BILLING_PORTAL_RESPONSE_INVALID",
      status: response.status,
      cause: error,
    });
  }
}
