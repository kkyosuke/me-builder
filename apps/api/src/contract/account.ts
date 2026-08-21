import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  ForbiddenErrorSchema,
  authenticatedErrors,
  csrfValidationError,
  jsonResponse,
} from "./shared/errors";

export const DeleteAccountRequestSchema = v.object({ confirmed: v.literal(true) });
export const InvalidDeleteAccountRequestSchema = v.object({ error: v.literal("Invalid request") });
const DeleteAccountRequestDocumentationSchema = {
  type: "object",
  additionalProperties: false,
  properties: { confirmed: { type: "boolean", const: true } },
  required: ["confirmed"] as string[],
} as const;

export const deleteAccountRoute = describeRoute({
  operationId: "deleteAccount",
  tags: ["Account"],
  summary: "本人のAccountと個人データを削除する",
  security: [{ applicationSession: [], csrfToken: [] }],
  requestBody: {
    required: true,
    content: { "application/json": { schema: DeleteAccountRequestDocumentationSchema } },
  },
  responses: {
    204: { description: "Accountと本人データを削除した" },
    ...csrfValidationError,
    ...authenticatedErrors,
    400: jsonResponse("明示確認を含むリクエストではない", InvalidDeleteAccountRequestSchema),
    403: jsonResponse("直近10分以内の本人確認がない", ForbiddenErrorSchema),
  },
} satisfies DescribeRouteOptions);
