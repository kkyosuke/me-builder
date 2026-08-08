import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { AccountNotFoundErrorSchema, authenticatedErrors, jsonResponse } from "../shared/errors";

const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

export const ResetDevelopmentDiagnosisDataResponseSchema = v.object({
  deletedResponseCount: CountSchema,
  deletedAnswerCount: CountSchema,
  deletedDeferredQuestionCount: CountSchema,
  deletedSourceRecordCount: CountSchema,
  deletedBrainItemCount: CountSchema,
});

export const DevelopmentRouteNotFoundErrorSchema = v.object({
  error: v.literal("Not Found"),
});

const ResetNotFoundErrorSchema = v.union([
  AccountNotFoundErrorSchema,
  DevelopmentRouteNotFoundErrorSchema,
]);

export const resetDevelopmentDiagnosisDataRoute = describeRoute({
  operationId: "resetDevelopmentDiagnosisData",
  tags: ["Development"],
  summary: "開発環境で本人の診断回答データを全削除する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse(
      "削除した本人の回答関連データ件数",
      ResetDevelopmentDiagnosisDataResponseSchema,
    ),
    ...authenticatedErrors,
    404: jsonResponse("開発環境ではない、または対応するAccountがない", ResetNotFoundErrorSchema),
  },
} satisfies DescribeRouteOptions);
