import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authenticatedErrors, jsonResponse } from "../shared/errors";

const Text = v.pipe(v.string(), v.trim(), v.nonEmpty());
const Kind = v.picklist(["worked", "did-not-work", "recent-state"]);
const Item = v.object({
  id: Text,
  brainItemId: Text,
  statement: Text,
  kind: Kind,
  status: v.picklist(["active", "revoked"]),
  confirmedAt: v.pipe(v.string(), v.isoTimestamp()),
  updatedAt: v.pipe(v.string(), v.isoTimestamp()),
});
export const SelfCareContextListSchema = v.object({ items: v.array(Item), canManage: v.boolean() });
export const ConfirmSelfCareContextRequestSchema = v.object({ brainItemId: Text, kind: Kind });
export const SelfCareContextMutationSchema = v.object({ item: Item });
export const SelfCareContextUnavailableSchema = v.object({
  error: v.literal("Self-care context unavailable"),
  reason: v.picklist(["feature_unavailable", "brain_item_not_found", "not_confirmed"]),
});
export const InvalidSelfCareContextSchema = v.object({
  error: v.literal("Invalid self-care context"),
});

const errors = {
  400: jsonResponse("リクエストJSONが不正", InvalidSelfCareContextSchema),
  409: jsonResponse("操作できない理由", SelfCareContextUnavailableSchema),
  ...authenticatedErrors,
};

export const selfCareContextListRoute = describeRoute({
  operationId: "getSelfCareContexts",
  tags: ["Profile"],
  summary: "本人が確認したセルフケア情報を取得する",
  security: [{ liffIdToken: [] }],
  responses: {
    200: jsonResponse("確認済みセルフケア情報", SelfCareContextListSchema),
    ...authenticatedErrors,
  },
} satisfies DescribeRouteOptions);

export const selfCareContextConfirmationRoute = describeRoute({
  operationId: "confirmSelfCareContext",
  tags: ["Profile"],
  summary: "対処の結果または最近の状態を本人が確認する",
  security: [{ liffIdToken: [] }],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            brainItemId: { type: "string", minLength: 1 },
            kind: { type: "string", enum: ["worked", "did-not-work", "recent-state"] },
          },
          required: ["brainItemId", "kind"],
        },
      },
    },
  },
  responses: { 200: jsonResponse("確認結果", SelfCareContextMutationSchema), ...errors },
} satisfies DescribeRouteOptions);

export const selfCareContextRevocationRoute = describeRoute({
  operationId: "revokeSelfCareContext",
  tags: ["Profile"],
  summary: "本人が確認を撤回する",
  security: [{ liffIdToken: [] }],
  responses: { 200: jsonResponse("撤回結果", SelfCareContextMutationSchema), ...errors },
} satisfies DescribeRouteOptions);
