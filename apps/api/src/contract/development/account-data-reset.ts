import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { AccountNotFoundErrorSchema, authenticatedErrors, jsonResponse } from "../shared/errors";

const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

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
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse(
      "削除した本人のAccountData件数とVector削除予定件数",
      ResetDevelopmentAccountDataResponseSchema,
    ),
    ...authenticatedErrors,
    404: jsonResponse("開発環境ではない、または対応するAccountがない", ResetNotFoundErrorSchema),
  },
} satisfies DescribeRouteOptions);
