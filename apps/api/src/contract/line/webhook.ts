import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { internalServerError, jsonResponse } from "../shared/errors";

export const LineWebhookAcceptedResponseSchema = v.object({
  status: v.literal("ok"),
  queued: v.boolean(),
  id: v.pipe(v.string(), v.uuid()),
});

export const LineWebhookUnauthorizedResponseSchema = v.object({
  error: v.literal("Unauthorized"),
});

export const lineWebhookRoute = describeRoute({
  operationId: "receiveLineWebhook",
  tags: ["LINE"],
  summary: "LINE署名を検証してWebhook eventを受理する",
  security: [{ lineWebhookSignature: [] }],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { type: "object", additionalProperties: true },
      },
    },
  },
  responses: {
    200: jsonResponse("署名検証済みWebhook eventの受理結果", LineWebhookAcceptedResponseSchema),
    401: jsonResponse(
      "LINE署名がない、無効、または検証設定がない",
      LineWebhookUnauthorizedResponseSchema,
    ),
    ...internalServerError,
  },
} satisfies DescribeRouteOptions);
