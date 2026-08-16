import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, currentTermsPolicyError, jsonResponse } from "../shared/errors";

const Text = v.pipe(v.string(), v.nonEmpty());
const ItemSchema = v.object({
  kind: v.picklist(["pattern", "value", "next-step", "question"]),
  title: Text,
  description: Text,
  evidenceCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  sources: v.pipe(v.array(v.picklist(["diagnosis", "diary"])), v.minLength(1)),
});
const ReflectionSchema = v.object({
  weekStart: v.pipe(v.string(), v.isoDate()),
  generatedAt: v.pipe(v.string(), v.isoTimestamp()),
  headline: Text,
  items: v.pipe(v.array(ItemSchema), v.minLength(1), v.maxLength(3)),
  recordCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
});

export const WeeklyReflectionResponseSchema = v.object({
  reflections: v.array(ReflectionSchema),
  monthlyChanges: v.array(
    v.object({
      month: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}$/)),
      version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
      generatedAt: v.pipe(v.string(), v.isoTimestamp()),
      mode: v.picklist(["brief", "full", "archived"]),
      headline: Text,
      previousMonthHeadline: v.nullable(Text),
      changes: v.array(Text),
      ongoingGoals: v.array(Text),
      evidenceWeekStarts: v.array(v.pipe(v.string(), v.isoDate())),
    }),
  ),
  generation: v.object({
    weekStart: v.pipe(v.string(), v.isoDate()),
    status: v.picklist(["idle", "queued", "generating", "completed", "failed"]),
    canGenerate: v.boolean(),
    message: v.nullable(Text),
    notification: v.picklist(["pending", "skipped", "not-applicable"]),
  }),
  canStartNew: v.boolean(),
});

export const WeeklyReflectionGenerationAcceptedSchema = v.object({
  generationId: Text,
  status: v.picklist(["queued", "generating", "completed"]),
  created: v.boolean(),
});

export const WeeklyReflectionGenerationUnavailableSchema = v.object({
  error: v.literal("Weekly reflection generation unavailable"),
  reason: v.picklist(["feature_unavailable", "source_record_required"]),
});

export const weeklyReflectionRoute = describeRoute({
  operationId: "getWeeklyReflections",
  tags: ["Profile"],
  summary: "週次振り返りと今週の生成状態を取得する",
  security: [{ applicationSession: [] }, { liffIdToken: [] }],
  responses: {
    200: jsonResponse("保存済み週次振り返り", WeeklyReflectionResponseSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);

export const weeklyReflectionGenerationRoute = describeRoute({
  operationId: "requestWeeklyReflectionGeneration",
  tags: ["Profile"],
  summary: "今週の振り返り生成を要求する",
  security: [{ applicationSession: [] }, { liffIdToken: [] }],
  responses: {
    202: jsonResponse("生成要求を受け付けた", WeeklyReflectionGenerationAcceptedSchema),
    409: jsonResponse("生成できない理由", WeeklyReflectionGenerationUnavailableSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);
