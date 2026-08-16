import { type DescribeRouteOptions, describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import {
  ServiceUnavailableErrorSchema,
  UnauthorizedErrorSchema,
  jsonResponse,
} from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const ServiceTermsDocumentSchema = v.object({
  documentKey: v.literal("terms_of_service"),
  version: NonEmptyStringSchema,
  contentHash: v.pipe(v.string(), v.regex(/^sha256:[0-9a-f]{64}$/)),
  requiresReacceptance: v.boolean(),
  publishedAt: v.pipe(v.string(), v.isoTimestamp()),
  title: NonEmptyStringSchema,
  summary: NonEmptyStringSchema,
  sections: v.array(
    v.object({ heading: NonEmptyStringSchema, paragraphs: v.array(NonEmptyStringSchema) }),
  ),
});

export const ServiceTermsStatusResponseSchema = v.object({
  document: ServiceTermsDocumentSchema,
  acceptance: v.object({
    required: v.boolean(),
    acceptedVersion: v.nullable(NonEmptyStringSchema),
    documentHash: v.nullable(v.pipe(v.string(), v.regex(/^sha256:[0-9a-f]{64}$/))),
    acceptedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  }),
});

export const AcceptServiceTermsRequestSchema = v.object({
  version: NonEmptyStringSchema,
});

export const AcceptServiceTermsResponseSchema = v.object({
  documentKey: v.literal("terms_of_service"),
  version: NonEmptyStringSchema,
  documentHash: v.pipe(v.string(), v.regex(/^sha256:[0-9a-f]{64}$/)),
  acceptedAt: v.pipe(v.string(), v.isoTimestamp()),
});

export const ServiceTermsAcceptanceHistoryResponseSchema = v.object({
  acceptances: v.array(
    v.object({
      documentKey: v.literal("terms_of_service"),
      version: NonEmptyStringSchema,
      documentHash: v.nullable(v.pipe(v.string(), v.regex(/^sha256:[0-9a-f]{64}$/))),
      acceptedAt: v.pipe(v.string(), v.isoTimestamp()),
      status: v.picklist(["current", "past"]),
    }),
  ),
});

export const ServiceTermsVersionConflictSchema = v.object({
  error: v.literal("Terms version is no longer current"),
  currentVersion: NonEmptyStringSchema,
});

export const InvalidServiceTermsRequestSchema = v.object({
  error: v.literal("Invalid request"),
});

export const acceptServiceTermsRequestValidator = validator(
  "json",
  AcceptServiceTermsRequestSchema,
  (result, c) =>
    result.success
      ? undefined
      : c.json(v.parse(InvalidServiceTermsRequestSchema, { error: "Invalid request" }), 400),
);

const commonErrors = {
  401: jsonResponse("LIFF IDトークンを検証できない", UnauthorizedErrorSchema),
  503: jsonResponse("D1 bindingが設定されていない", ServiceUnavailableErrorSchema),
};

export const getServiceTermsRoute = describeRoute({
  operationId: "getServiceTermsStatus",
  tags: ["Legal"],
  summary: "現在の利用規約と本人の同意状態を取得する",
  security: [{ applicationSession: [] }, { liffIdToken: [] }],
  responses: {
    200: jsonResponse("現在の規約本文と同意状態", ServiceTermsStatusResponseSchema),
    ...commonErrors,
  },
} satisfies DescribeRouteOptions);

export const acceptServiceTermsRoute = describeRoute({
  operationId: "acceptServiceTerms",
  tags: ["Legal"],
  summary: "現在の利用規約versionへの同意を記録する",
  security: [{ applicationSession: [] }, { liffIdToken: [] }],
  responses: {
    200: jsonResponse("保存済みの同意記録", AcceptServiceTermsResponseSchema),
    400: jsonResponse("リクエストJSONが不正", InvalidServiceTermsRequestSchema),
    409: jsonResponse("表示後に規約versionが更新された", ServiceTermsVersionConflictSchema),
    ...commonErrors,
  },
} satisfies DescribeRouteOptions);

export const getServiceTermsAcceptanceHistoryRoute = describeRoute({
  operationId: "getServiceTermsAcceptanceHistory",
  tags: ["Legal"],
  summary: "本人の利用規約同意履歴を取得する",
  security: [{ applicationSession: [] }, { liffIdToken: [] }],
  responses: {
    200: jsonResponse(
      "現在有効・過去を区別した本人の同意履歴",
      ServiceTermsAcceptanceHistoryResponseSchema,
    ),
    ...commonErrors,
  },
} satisfies DescribeRouteOptions);
