import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

const ProfileInsightSchema = v.object({
  key: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  evidenceCount: v.pipe(CountSchema, v.minValue(1)),
  sources: v.pipe(v.array(v.picklist(["diagnosis", "diary"])), v.minLength(1)),
});

const ProfileSummarySchema = v.object({
  generatedAt: v.pipe(v.string(), v.isoTimestamp()),
  headline: NonEmptyStringSchema,
  insights: v.pipe(v.array(ProfileInsightSchema), v.maxLength(3)),
  recordCount: CountSchema,
  diagnosisCount: CountSchema,
  diaryCount: CountSchema,
  latestRecordedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
});

export const ProfileSummaryResponseSchema = v.object({
  summary: v.nullable(ProfileSummarySchema),
  nextAction: v.picklist(["diagnosis", "chat"]),
});

export const profileSummaryRoute = describeRoute({
  operationId: "getProfileSummary",
  tags: ["Profile"],
  summary: "本人の記録から生成したまとめを取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("本人向けのまとめと、次にできること", ProfileSummaryResponseSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
