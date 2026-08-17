import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  ForbiddenErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
export const AdminBillingHealthResponseSchema = v.object({
  status: v.picklist(["healthy", "degraded"]),
  checkedAt: v.pipe(v.string(), v.isoTimestamp()),
  customerCount: CountSchema,
  activeSubscriptionCount: CountSchema,
  staleProjectionCount: CountSchema,
  customerWithoutProjectionCount: CountSchema,
  projectionWithoutPlanCount: CountSchema,
  statusCounts: v.record(v.string(), CountSchema),
  planCounts: v.record(v.string(), CountSchema),
});

export const adminBillingHealthRoute = describeRoute({
  operationId: "getAdminBillingHealth",
  tags: ["Admin"],
  summary: "個人内容を含まない課金projectionの運用状態を確認する",
  security: [{ applicationSession: [] }],
  responses: {
    200: jsonResponse("課金projectionの安全な集計と劣化判定", AdminBillingHealthResponseSchema),
    403: jsonResponse("管理者権限がない", ForbiddenErrorSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);
