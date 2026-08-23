import { config } from "../../../config";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";

const client = createAuthenticatedHttpClient(config.apiUrl);

export type McpConnection = {
  id: string;
  clientId: string;
  clientName: string;
  scope: "brain:search";
  accessProfile: "owner";
  status: "active" | "revoked";
  authorizedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
export type McpAuditRecord = {
  id: string;
  connectionId: string;
  clientName: string;
  outcome: "success" | "refused" | "failure";
  reasonCode: string;
  resultCount: number;
  brainItemIds: string[];
  occurredAt: string;
};
export type McpAuthorizationRequest = {
  id: string;
  clientName: string;
  clientId: string;
  scope: "brain:search";
  accessProfile: "owner";
  expiresAt: string;
};

async function json<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) throw new Error(message);
  return (await response.json()) as T;
}

export async function fetchMcpConnections(signal?: AbortSignal) {
  return json<{ connections: McpConnection[] }>(
    await client.request("/api/mcp/connections", signal ? { signal } : undefined),
    "MCP接続を取得できませんでした。",
  );
}

export async function fetchMcpAudit(signal?: AbortSignal) {
  return json<{ records: McpAuditRecord[] }>(
    await client.request("/api/mcp/audit-records", signal ? { signal } : undefined),
    "取得履歴を取得できませんでした。",
  );
}

export async function revokeMcpConnection(id: string) {
  const response = await client.request(`/api/mcp/connections/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) throw new Error("MCP接続を解除できませんでした。");
}

export async function fetchMcpAuthorizationRequest(id: string, signal?: AbortSignal) {
  return json<McpAuthorizationRequest>(
    await client.request(
      `/api/mcp/authorization-requests/${encodeURIComponent(id)}`,
      signal ? { signal } : undefined,
    ),
    "接続要求が期限切れか、利用できません。",
  );
}

export async function decideMcpAuthorizationRequest(id: string, allow: boolean) {
  return json<{ redirectUrl: string }>(
    await client.request(`/api/mcp/authorization-requests/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allow }),
    }),
    "接続要求を確定できませんでした。",
  );
}
