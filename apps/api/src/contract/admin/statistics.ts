import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { ForbiddenErrorSchema, authenticatedErrors, jsonResponse } from "../shared/errors";

const UnavailableSectionSchema = v.object({
  status: v.literal("unavailable"),
  reason: v.picklist(["not-configured", "upstream-error"]),
});

export const AdminStatisticsResponseSchema = v.object({
  period: v.object({
    start: v.pipe(v.string(), v.isoTimestamp()),
    end: v.pipe(v.string(), v.isoTimestamp()),
  }),
  fetchedAt: v.pipe(v.string(), v.isoTimestamp()),
  gemini: v.union([
    v.object({
      status: v.literal("available"),
      estimatedCostUsd: v.number(),
      requestCount: v.number(),
      inputTokens: v.number(),
      outputTokens: v.number(),
    }),
    UnavailableSectionSchema,
  ]),
  line: v.union([
    v.object({
      status: v.literal("available"),
      billableMessages: v.number(),
      monthlyLimit: v.nullable(v.number()),
      replyMessages: v.number(),
    }),
    UnavailableSectionSchema,
  ]),
});

export const adminStatisticsRoute = describeRoute({
  operationId: "getAdminStatistics",
  tags: ["Admin"],
  summary: "GeminiとLINEの当月利用統計を取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("管理者向け利用統計", AdminStatisticsResponseSchema),
    403: jsonResponse("管理者権限がない", ForbiddenErrorSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
