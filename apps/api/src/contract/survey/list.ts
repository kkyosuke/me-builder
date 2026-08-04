import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());

const SurveyListItemSchema = v.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  opensAt: TimestampSchema,
  closesAt: v.nullable(TimestampSchema),
  availability: v.picklist(["open", "closed"]),
  responseStatus: v.picklist(["unanswered", "in-progress", "answered"]),
  answeredCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  questionCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
});

export const SurveyListResponseSchema = v.object({
  surveys: v.array(SurveyListItemSchema),
});

export const surveyListRoute = describeRoute({
  operationId: "listSurveys",
  tags: ["Survey"],
  summary: "回答進捗を含むアンケート一覧を取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("アンケート一覧", SurveyListResponseSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
