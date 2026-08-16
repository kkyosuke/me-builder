import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { AccountNotFoundErrorSchema, authenticatedErrors, jsonResponse } from "../shared/errors";

export const BillingCheckoutRequestSchema = v.object({
  plan: v.picklist(["lite", "full", "family"]),
  interval: v.picklist(["month", "year"]),
});

export const BillingPlanCatalogResponseSchema = v.object({
  plans: v.array(
    v.object({
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
    }),
  ),
});

export const BillingSessionResponseSchema = v.object({
  url: v.pipe(v.string(), v.url()),
});

export const BillingCheckoutSessionIdSchema = v.pipe(
  v.string(),
  v.regex(/^cs_(?:test_|live_)?[A-Za-z0-9]+$/),
);

export const BillingCheckoutSessionStatusResponseSchema = v.object({
  status: v.picklist(["open", "complete", "expired"]),
});

export const BillingCheckoutSessionNotFoundSchema = v.object({
  error: v.literal("Checkout session not found"),
});

export const BillingSessionConflictSchema = v.object({
  error: v.literal("Billing session unavailable"),
  reason: v.picklist([
    "plan_unavailable",
    "existing_subscription",
    "checkout_in_progress",
    "customer_not_found",
  ]),
});

export const BillingInvalidRequestSchema = v.object({ error: v.literal("Invalid request") });

export const billingCheckoutSessionRoute = describeRoute({
  operationId: "createBillingCheckoutSession",
  tags: ["Billing"],
  summary: "本人の選択したPlanに対するStripe Checkout Sessionを作成する",
  security: [{ liffIdToken: [] }],
  requestBody: {
    required: true,
    content: { "application/json": { schema: BillingCheckoutRequestSchema } },
  },
  responses: {
    201: jsonResponse("短命なStripe Checkout URL", BillingSessionResponseSchema),
    400: jsonResponse("リクエストが不正", BillingInvalidRequestSchema),
    409: jsonResponse("購入を開始できない", BillingSessionConflictSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);

export const billingCheckoutSessionStatusRoute = describeRoute({
  operationId: "getBillingCheckoutSessionStatus",
  tags: ["Billing"],
  summary: "Checkout Sessionが本人のものであることと完了状態を確認する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("本人のCheckout Session状態", BillingCheckoutSessionStatusResponseSchema),
    ...authenticatedErrors,
    404: jsonResponse(
      "Accountまたは本人のCheckout Sessionが存在しない",
      v.union([AccountNotFoundErrorSchema, BillingCheckoutSessionNotFoundSchema]),
    ),
  },
} satisfies DescribeRouteOptions);

export const billingPlanCatalogRoute = describeRoute({
  operationId: "getBillingPlanCatalog",
  tags: ["Billing"],
  summary: "現在購入できる有料Planと税込価格を取得する",
  responses: {
    200: jsonResponse("公開可能なPlan catalog", BillingPlanCatalogResponseSchema),
  },
} satisfies DescribeRouteOptions);

export const billingPortalSessionRoute = describeRoute({
  operationId: "createBillingPortalSession",
  tags: ["Billing"],
  summary: "本人のStripe Customerに対するCustomer Portal Sessionを作成する",
  security: [{ liffIdToken: [] }],
  responses: {
    201: jsonResponse("短命なStripe Customer Portal URL", BillingSessionResponseSchema),
    409: jsonResponse("Portalを開始できない", BillingSessionConflictSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
