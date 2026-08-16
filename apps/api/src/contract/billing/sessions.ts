import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

export const BillingCheckoutRequestSchema = v.object({
  plan: v.picklist(["lite", "full", "family"]),
  interval: v.picklist(["month", "year"]),
});

export const BillingSessionResponseSchema = v.object({
  url: v.pipe(v.string(), v.url()),
});

export const BillingSessionConflictSchema = v.object({
  error: v.literal("Billing session unavailable"),
  reason: v.picklist(["plan_unavailable", "existing_subscription", "checkout_in_progress"]),
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
