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

export const ReadinessResponseSchema = v.object({
  status: v.literal("ready"),
  timestamp: v.pipe(v.string(), v.isoTimestamp()),
});

export const ReadinessUnavailableResponseSchema = v.object({
  status: v.literal("unavailable"),
  timestamp: v.pipe(v.string(), v.isoTimestamp()),
});

export const readinessRoute = describeRoute({
  operationId: "getReadiness",
  tags: ["System"],
  summary: "API Serverが依存先を含めて受付可能か取得する",
  security: [],
  responses: {
    200: jsonResponse("API Serverはリクエストを受付可能", ReadinessResponseSchema),
    503: jsonResponse("API Serverはリクエストを受付不能", ReadinessUnavailableResponseSchema),
    ...internalServerError,
  },
} satisfies DescribeRouteOptions);
