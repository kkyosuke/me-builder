import { toJsonSchema } from "@valibot/to-json-schema";
import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());

export const LiffSessionRequestSchema = v.object({
  idToken: NonEmptyStringSchema,
});

export const LiffSessionResponseSchema = v.object({
  displayName: v.optional(NonEmptyStringSchema),
  pictureUrl: v.optional(v.pipe(v.string(), v.url())),
});

type RequestBodyObject = Exclude<
  NonNullable<DescribeRouteOptions["requestBody"]>,
  { $ref: string }
>;
type RequestSchema = NonNullable<RequestBodyObject["content"][string]["schema"]>;

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
