import { toJsonSchema } from "@valibot/to-json-schema";
import {
  type DescribeRouteOptions,
  type GenerateSpecOptions,
  describeRoute,
  resolver,
} from "hono-openapi";
import * as v from "valibot";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());

export const LiffSessionRequestSchema = v.object({
  idToken: NonEmptyStringSchema,
});

export const LiffSessionResponseSchema = v.object({
  displayName: v.optional(NonEmptyStringSchema),
  pictureUrl: v.optional(v.pipe(v.string(), v.url())),
});

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

export const UnauthorizedErrorSchema = v.object({
  error: v.literal("Unauthorized"),
});

export const AccountNotFoundErrorSchema = v.object({
  error: v.literal("Account not found"),
  reason: v.literal("friendship_required"),
});

export const ServiceUnavailableErrorSchema = v.object({
  error: v.literal("Service Unavailable"),
});

export const InternalServerErrorSchema = v.object({
  error: v.literal("Internal Server Error"),
});

const jsonResponse = (description: string, schema: Parameters<typeof resolver>[0]) => ({
  description,
  content: {
    "application/json": {
      schema: resolver(schema),
    },
  },
});

const authenticatedErrors = {
  401: jsonResponse("LIFF IDトークンを検証できない", UnauthorizedErrorSchema),
  404: jsonResponse("対応するAccountが存在しない", AccountNotFoundErrorSchema),
  503: jsonResponse("D1 bindingが設定されていない", ServiceUnavailableErrorSchema),
  500: jsonResponse("未処理のサーバーエラー", InternalServerErrorSchema),
};

type RequestBodyObject = Exclude<
  NonNullable<DescribeRouteOptions["requestBody"]>,
  { $ref: string }
>;
type RequestSchema = NonNullable<RequestBodyObject["content"][string]["schema"]>;

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

export const liffSessionRoute = describeRoute({
  operationId: "verifyLiffSession",
  tags: ["LIFF"],
  summary: "LIFF IDトークンを検証してAccountを解決する",
  requestBody: {
    required: true,
    content: {
      "application/json": {
        // requestBodyはhono-openapiのresolver対象外なので、同じValibot schemaを直接変換する。
        schema: toJsonSchema(LiffSessionRequestSchema) as unknown as RequestSchema,
      },
    },
  },
  responses: {
    200: jsonResponse("表示可能なLINEプロフィール", LiffSessionResponseSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);

export const openApiOptions = {
  documentation: {
    info: {
      title: "me-builder API",
      version: "0.1.0",
      description: "me-builder Web UIが利用するHTTP API契約",
    },
    components: {
      securitySchemes: {
        liffIdToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "LIFF ID token",
        },
      },
    },
  },
  exclude: ["/api/openapi.json"],
} satisfies Partial<GenerateSpecOptions>;
