import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { ServiceUnavailableErrorSchema, internalServerError, jsonResponse } from "../shared/errors";

export const StripeWebhookAcceptedResponseSchema = v.object({
  status: v.literal("ok"),
  queued: v.boolean(),
});

export const StripeWebhookInvalidResponseSchema = v.object({
  error: v.literal("Invalid webhook"),
});

export const stripeWebhookRoute = describeRoute({
  operationId: "receiveStripeWebhook",
  tags: ["Billing"],
  summary: "Stripe署名を検証して課金Webhook eventを受理する",
  security: [{ stripeWebhookSignature: [] }],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { type: "object", additionalProperties: true },
      },
    },
  },
  responses: {
    200: jsonResponse("署名検証済みWebhook eventの受理結果", StripeWebhookAcceptedResponseSchema),
    400: jsonResponse("Stripe署名またはpayloadが無効", StripeWebhookInvalidResponseSchema),
    503: jsonResponse("StripeまたはQueue設定がない", ServiceUnavailableErrorSchema),
    ...internalServerError,
  },
} satisfies DescribeRouteOptions);
