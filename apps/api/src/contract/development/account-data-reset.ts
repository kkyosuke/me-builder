import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  AccountNotFoundErrorSchema,
  ForbiddenErrorSchema,
  authenticatedErrors,
  csrfValidationError,
  currentTermsPolicyError,
  jsonResponse,
} from "../shared/errors";

const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

export const ResetDevelopmentAccountDataRequestSchema = v.object({
  confirmed: v.literal(true),
});

export const InvalidDevelopmentResetRequestSchema = v.object({
  error: v.literal("Invalid request"),
});

export const ResetDevelopmentAccountDataResponseSchema = v.object({
  deletedDiagnosisResponseCount: CountSchema,
  deletedConversationSessionCount: CountSchema,
  deletedSourceRecordCount: CountSchema,
  deletedBrainItemCount: CountSchema,
  deletedProfileSummaryVersionCount: CountSchema,
  scheduledVectorDeletionCount: CountSchema,
});

export const DevelopmentRouteNotFoundErrorSchema = v.object({
  error: v.literal("Not Found"),
});

const ResetNotFoundErrorSchema = v.union([
  AccountNotFoundErrorSchema,
  DevelopmentRouteNotFoundErrorSchema,
]);

export const resetDevelopmentAccountDataRoute = describeRoute({
  operationId: "resetDevelopmentAccountData",
  tags: ["Development"],
  summary: "開発環境で本人の個人コンテンツを全削除する",
  security: [{ applicationSession: [], csrfToken: [] }],
  requestBody: {
    required: true,
    content: { "application/json": { schema: ResetDevelopmentAccountDataRequestSchema } },
  },
  responses: {
    200: jsonResponse(
      "削除した本人のAccountData件数とVector削除予定件数",
      ResetDevelopmentAccountDataResponseSchema,
    ),
    ...csrfValidationError,
    ...authenticatedErrors,
    ...currentTermsPolicyError,
    400: jsonResponse("明示確認を含むリクエストではない", InvalidDevelopmentResetRequestSchema),
    403: jsonResponse("直近10分以内の本人確認がない", ForbiddenErrorSchema),
    404: jsonResponse("開発環境ではない、または対応するAccountがない", ResetNotFoundErrorSchema),
  },
} satisfies DescribeRouteOptions);
