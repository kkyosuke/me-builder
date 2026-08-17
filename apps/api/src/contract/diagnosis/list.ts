import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, currentTermsPolicyError, jsonResponse } from "../shared/errors";
import { RelationshipCategorySchema } from "./shared";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());

const DiagnosisListItemSchema = v.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  relationshipCategory: RelationshipCategorySchema,
  opensAt: TimestampSchema,
  closesAt: v.nullable(TimestampSchema),
  displayOrder: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  availability: v.picklist(["open", "closed"]),
  responseStatus: v.picklist(["unanswered", "in-progress", "answered"]),
  answeredCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  questionCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  lastAnsweredAt: v.nullable(TimestampSchema),
});

export const DiagnosisListResponseSchema = v.object({
  diagnoses: v.array(DiagnosisListItemSchema),
});

export const diagnosisListRoute = describeRoute({
  operationId: "listDiagnoses",
  tags: ["Diagnosis"],
  summary: "回答進捗を含む診断一覧を取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("診断一覧", DiagnosisListResponseSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);
