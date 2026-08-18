import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { internalServerError, jsonResponse } from "./shared/errors";

export const HealthResponseSchema = v.object({
  status: v.literal("ok"),
  environment: v.string(),
  timestamp: v.pipe(v.string(), v.isoTimestamp()),
});

export const healthRoute = describeRoute({
  operationId: "getHealth",
  tags: ["System"],
  summary: "API Serverの死活状態を取得する",
  security: [],
  responses: {
    200: jsonResponse("API Serverの死活状態", HealthResponseSchema),
    ...internalServerError,
  },
} satisfies DescribeRouteOptions);
