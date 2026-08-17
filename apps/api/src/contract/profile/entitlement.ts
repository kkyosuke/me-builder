import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, currentTermsPolicyError, jsonResponse } from "../shared/errors";

const UsageSchema = v.object({
  limit: v.pipe(v.number(), v.integer(), v.minValue(0)),
  used: v.pipe(v.number(), v.integer(), v.minValue(0)),
  reserved: v.pipe(v.number(), v.integer(), v.minValue(0)),
  remaining: v.pipe(v.number(), v.integer(), v.minValue(0)),
  periodStartsAt: v.pipe(v.string(), v.isoTimestamp()),
  resetsAt: v.pipe(v.string(), v.isoTimestamp()),
});

export const ProfileEntitlementResponseSchema = v.object({
  status: v.picklist(["free", "active", "safe-default"]),
  plan: v.picklist(["free", "lite", "full", "family"]),
  source: v.picklist(["free", "subscription", "family-seat"]),
  effectiveAt: v.pipe(v.string(), v.isoTimestamp()),
  availableUntil: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  aiReply: UsageSchema,
  profileSummary: UsageSchema,
});

export const profileEntitlementRoute = describeRoute({
  operationId: "getProfileEntitlement",
  tags: ["Profile"],
  summary: "本人のPlanとAI利用上限・残量を取得する",
  security: [{ applicationSession: [] }, { liffIdToken: [] }],
  responses: {
    200: jsonResponse("本人の現在の利用権限", ProfileEntitlementResponseSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);
