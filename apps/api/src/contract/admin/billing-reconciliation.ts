import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  AccountNotFoundErrorSchema,
  ForbiddenErrorSchema,
  authenticatedErrors,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

export const AdminBillingReconciliationRequestSchema = v.object({
  accountId: v.pipe(v.string(), v.uuid()),
  mode: v.optional(v.picklist(["dry-run", "apply"]), "dry-run"),
  confirmed: v.optional(v.boolean(), false),
});

export const AdminBillingReconciliationResponseSchema = v.object({
  operationId: v.pipe(v.string(), v.uuid()),
  mode: v.picklist(["dry-run", "apply"]),
  differenceFields: v.array(
    v.picklist([
      "projection",
      "status",
      "plan",
      "periodStart",
      "periodEnd",
      "cancelAtPeriodEnd",
      "trialEnd",
    ]),
  ),
  repaired: v.boolean(),
});

export const BillingCustomerNotFoundSchema = v.object({
  error: v.literal("Billing customer not found"),
});
export const InvalidBillingReconciliationSchema = v.object({ error: v.literal("Invalid request") });
export const BillingReconciliationUnavailableSchema = v.object({ error: v.literal("Not Found") });

export const adminBillingReconciliationRoute = describeRoute({
  operationId: "reconcileAdminBillingProjection",
  tags: ["Admin"],
  summary: "Stripeの現在契約と課金projectionの差分を確認・修復する",
  security: [{ applicationSession: [], csrfToken: [] }],
  requestBody: {
    required: true,
    content: { "application/json": { schema: AdminBillingReconciliationRequestSchema } },
  },
  responses: {
    200: jsonResponse("再照合結果", AdminBillingReconciliationResponseSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    400: jsonResponse("リクエストが不正", InvalidBillingReconciliationSchema),
    403: jsonResponse("管理者権限がない", ForbiddenErrorSchema),
    404: jsonResponse(
      "認証Account、対象Customerがない、またはPreview以外で利用できない",
      v.union([
        AccountNotFoundErrorSchema,
        BillingCustomerNotFoundSchema,
        BillingReconciliationUnavailableSchema,
      ]),
    ),
  },
} satisfies DescribeRouteOptions);
