import { type DescribeRouteOptions, describeRoute } from "hono-openapi";
import * as v from "valibot";
import {
  ForbiddenErrorSchema,
  authenticatedErrors,
  csrfValidationError,
  currentTermsPolicyError,
  jsonResponse,
} from "./shared/errors";

const McpConnectionSchema = v.object({
  id: v.string(),
  clientId: v.string(),
  clientName: v.string(),
  scope: v.literal("brain:search"),
  accessProfile: v.literal("owner"),
  status: v.picklist(["active", "revoked"]),
  authorizedAt: v.string(),
  lastUsedAt: v.nullable(v.string()),
  revokedAt: v.nullable(v.string()),
});

export const McpConnectionsResponseSchema = v.object({ connections: v.array(McpConnectionSchema) });
export const McpAuditResponseSchema = v.object({
  records: v.array(
    v.object({
      id: v.string(),
      connectionId: v.string(),
      clientName: v.string(),
      outcome: v.picklist(["success", "refused", "failure"]),
      reasonCode: v.string(),
      resultCount: v.number(),
      brainItemIds: v.array(v.string()),
      occurredAt: v.string(),
    }),
  ),
});
export const McpAuthorizationRequestResponseSchema = v.object({
  id: v.string(),
  clientName: v.string(),
  clientId: v.string(),
  scope: v.literal("brain:search"),
  accessProfile: v.literal("owner"),
  expiresAt: v.string(),
});
export const McpAuthorizationDecisionSchema = v.object({ allow: v.boolean() });
export const McpAuthorizationDecisionResponseSchema = v.object({ redirectUrl: v.string() });
const McpTokenResponseSchema = v.object({
  access_token: v.string(),
  token_type: v.literal("Bearer"),
  expires_in: v.number(),
  refresh_token: v.string(),
  scope: v.literal("brain:search"),
});
const McpOAuthErrorSchema = v.object({ error: v.string() });
const McpNotFoundErrorSchema = v.object({ error: v.literal("Not Found") });
const McpInvalidRequestErrorSchema = v.object({ error: v.literal("Invalid request") });

const adminErrors = {
  ...authenticatedErrors,
  ...currentTermsPolicyError,
  403: jsonResponse("管理者権限がない、またはCSRF検証に失敗した", ForbiddenErrorSchema),
};
export const mcpAuthorizeRoute = describeRoute({
  operationId: "authorizeMcpClient",
  tags: ["Admin", "MCP OAuth"],
  summary: "検証済みCIMDを管理者本人の同意画面へ渡す",
  security: [{ applicationSession: [] }],
  responses: { 302: { description: "Web同意画面へ移動" }, ...adminErrors },
} satisfies DescribeRouteOptions);
export const mcpTokenRoute = describeRoute({
  operationId: "issueMcpToken",
  tags: ["MCP OAuth"],
  summary: "Authorization Codeまたはrefresh tokenを交換する",
  security: [],
  responses: {
    200: jsonResponse("OAuth token response", McpTokenResponseSchema),
    400: jsonResponse("OAuth error", McpOAuthErrorSchema),
    401: jsonResponse("client_idがない、または一致しない", McpOAuthErrorSchema),
    500: jsonResponse("未処理のサーバーエラー", McpOAuthErrorSchema),
    503: jsonResponse("MCP停止中", McpOAuthErrorSchema),
  },
} satisfies DescribeRouteOptions);
export const listMcpConnectionsRoute = describeRoute({
  operationId: "listMcpConnections",
  tags: ["Admin", "MCP"],
  summary: "管理者本人のMCP接続を取得する",
  security: [{ applicationSession: [] }],
  responses: { 200: jsonResponse("MCP接続", McpConnectionsResponseSchema), ...adminErrors },
} satisfies DescribeRouteOptions);
export const listMcpAuditRoute = describeRoute({
  operationId: "listMcpAudit",
  tags: ["Admin", "MCP"],
  summary: "管理者本人のMCP取得履歴を取得する",
  security: [{ applicationSession: [] }],
  responses: { 200: jsonResponse("MCP取得履歴", McpAuditResponseSchema), ...adminErrors },
} satisfies DescribeRouteOptions);
export const revokeMcpConnectionRoute = describeRoute({
  operationId: "revokeMcpConnection",
  tags: ["Admin", "MCP"],
  summary: "管理者本人のMCP接続を解除する",
  security: [{ applicationSession: [], csrfToken: [] }],
  responses: {
    ...csrfValidationError,
    ...adminErrors,
    204: { description: "解除済み" },
    404: jsonResponse("対象なし", McpNotFoundErrorSchema),
  },
} satisfies DescribeRouteOptions);
export const getMcpAuthorizationRequestRoute = describeRoute({
  operationId: "getMcpAuthorizationRequest",
  tags: ["Admin", "MCP"],
  summary: "MCP認可画面の検証済みclient情報を取得する",
  security: [{ applicationSession: [] }],
  responses: {
    ...adminErrors,
    200: jsonResponse("認可要求", McpAuthorizationRequestResponseSchema),
    404: jsonResponse("期限切れまたは対象なし", McpNotFoundErrorSchema),
  },
} satisfies DescribeRouteOptions);
export const decideMcpAuthorizationRequestRoute = describeRoute({
  operationId: "decideMcpAuthorizationRequest",
  tags: ["Admin", "MCP"],
  summary: "MCP接続の許可または拒否を確定する",
  security: [{ applicationSession: [], csrfToken: [] }],
  responses: {
    ...csrfValidationError,
    ...adminErrors,
    200: jsonResponse("client callback", McpAuthorizationDecisionResponseSchema),
    400: jsonResponse("リクエストが不正", McpInvalidRequestErrorSchema),
    404: jsonResponse("期限切れまたは対象なし", McpNotFoundErrorSchema),
  },
} satisfies DescribeRouteOptions);
