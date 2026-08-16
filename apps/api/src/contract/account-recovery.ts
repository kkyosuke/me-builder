import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, currentTermsPolicyError, jsonResponse } from "./shared/errors";

export const AccountRecoveryCodeResponseSchema = v.object({
  code: v.pipe(v.string(), v.nonEmpty()),
  expiresAt: v.pipe(v.string(), v.isoTimestamp()),
});
export const AccountRecoveryCompleteRequestSchema = v.object({
  code: v.pipe(v.string(), v.nonEmpty(), v.maxLength(256)),
});
export const AccountRecoveryCompleteResponseSchema = v.object({
  status: v.literal("recovered"),
  alreadyRecovered: v.boolean(),
});
export const AccountRecoveryUnavailableSchema = v.object({
  error: v.picklist([
    "Paid contract required",
    "Invalid recovery code",
    "Identity conflict",
    "Too many recovery attempts",
  ]),
});

export const accountRecoveryCodeRoute = describeRoute({
  operationId: "issueAccountRecoveryCode",
  tags: ["Account recovery"],
  summary: "有料契約Accountの一回限りの復旧コードを発行する",
  security: [{ liffIdToken: [] }],
  responses: {
    201: jsonResponse("一度だけ表示する復旧コード", AccountRecoveryCodeResponseSchema),
    409: jsonResponse("有料契約がない", AccountRecoveryUnavailableSchema),
    ...authenticatedErrors,
    ...currentTermsPolicyError,
  },
} satisfies DescribeRouteOptions);

export const accountRecoveryCompleteRoute = describeRoute({
  operationId: "completeAccountRecovery",
  tags: ["Account recovery"],
  summary: "新しいLINE Identityを既存Accountへ再接続する",
  security: [{ liffIdToken: [] }],
  requestBody: {
    required: true,
    content: { "application/json": { schema: AccountRecoveryCompleteRequestSchema } },
  },
  responses: {
    200: jsonResponse("復旧済みAccount", AccountRecoveryCompleteResponseSchema),
    400: jsonResponse("復旧コードが不正", AccountRecoveryUnavailableSchema),
    409: jsonResponse("Identityが別Accountに接続済み", AccountRecoveryUnavailableSchema),
    429: jsonResponse("復旧試行が一時的に制限されている", AccountRecoveryUnavailableSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);
