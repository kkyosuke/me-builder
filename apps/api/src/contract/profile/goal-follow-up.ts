import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, currentTermsPolicyError, jsonResponse } from "../shared/errors";

const Text = v.pipe(v.string(), v.trim(), v.nonEmpty());
const GoalFollowUpSchema = v.object({
  id: Text,
  brainItemId: Text,
  goal: Text,
  nextStep: Text,
  status: v.picklist(["active", "completed", "stopped"]),
  agreedAt: v.pipe(v.string(), v.isoTimestamp()),
  updatedAt: v.pipe(v.string(), v.isoTimestamp()),
});
export const GoalFollowUpListSchema = v.object({
  items: v.array(GoalFollowUpSchema),
  canManage: v.boolean(),
  activeLimit: v.nullable(v.literal(1)),
});
export const AgreeGoalFollowUpRequestSchema = v.object({
  brainItemId: Text,
  nextStep: v.pipe(Text, v.maxLength(500)),
});
export const UpdateGoalFollowUpRequestSchema = v.pipe(
  v.object({
    status: v.optional(v.picklist(["active", "completed", "stopped"])),
    nextStep: v.optional(v.pipe(Text, v.maxLength(500))),
  }),
  v.check((input) => input.status !== undefined || input.nextStep !== undefined),
);
export const GoalFollowUpMutationSchema = v.object({ item: GoalFollowUpSchema });
export const GoalFollowUpUnavailableSchema = v.object({
  error: v.literal("Goal follow-up unavailable"),
  reason: v.picklist([
    "feature_unavailable",
    "active_limit",
    "goal_not_found",
    "goal_not_confirmed",
  ]),
});
export const InvalidGoalFollowUpSchema = v.object({
  error: v.literal("Invalid goal follow-up"),
});

const errors = {
  400: jsonResponse("リクエストJSONが不正", InvalidGoalFollowUpSchema),
  409: jsonResponse("操作できない理由", GoalFollowUpUnavailableSchema),
  ...authenticatedErrors,
  ...currentTermsPolicyError,
};

export const goalFollowUpListRoute = describeRoute({
  operationId: "getGoalFollowUps",
  tags: ["Profile"],
  summary: "本人が合意したGoalのフォローアップを取得する",
  security: [{ applicationSession: [] }, { liffIdToken: [] }],
  responses: {
    200: jsonResponse("Goalフォローアップ", GoalFollowUpListSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);

export const goalFollowUpAgreementRoute = describeRoute({
  operationId: "agreeGoalFollowUp",
  tags: ["Profile"],
  summary: "本人がGoalと次の一歩をフォロー対象として合意する",
  security: [{ applicationSession: [] }, { liffIdToken: [] }],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            brainItemId: { type: "string", minLength: 1 },
            nextStep: { type: "string", minLength: 1, maxLength: 500 },
          },
          required: ["brainItemId", "nextStep"],
        },
      },
    },
  },
  responses: { 200: jsonResponse("合意結果", GoalFollowUpMutationSchema), ...errors },
} satisfies DescribeRouteOptions);

export const goalFollowUpUpdateRoute = describeRoute({
  operationId: "updateGoalFollowUp",
  tags: ["Profile"],
  summary: "本人がGoalを完了・停止・訂正する",
  security: [{ applicationSession: [] }, { liffIdToken: [] }],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["active", "completed", "stopped"] },
            nextStep: { type: "string", minLength: 1, maxLength: 500 },
          },
          minProperties: 1,
        },
      },
    },
  },
  responses: { 200: jsonResponse("更新結果", GoalFollowUpMutationSchema), ...errors },
} satisfies DescribeRouteOptions);
