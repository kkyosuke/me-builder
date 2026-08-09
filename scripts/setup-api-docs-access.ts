/**
 * OpenAPI documentとSwagger UI用パスをCloudflare Accessで保護します。
 *
 *   bun scripts/setup-api-docs-access.ts <preview|production>
 *
 * 必要な環境変数:
 *   - CLOUDFLARE_ACCOUNT_ID
 *   - CLOUDFLARE_API_TOKEN             (Access: Apps and Policies Write)
 *   - BASE_DOMAIN                      (例: stg.kagami.kyosuke.dev)
 *   - CLOUDFLARE_ACCESS_ALLOWED_EMAILS (許可するメールアドレス、カンマ区切り)
 *
 * Accessの作成に失敗した状態でAPIドキュメントを公開しないため、設定不足やAPIエラーは
 * 終了コード0へ変換せず、そのままデプロイを失敗させます。
 */

const API_BASE = "https://api.cloudflare.com/client/v4";
const SESSION_DURATION = "24h";
const POLICY_NAME = "Allow me-builder API docs developers";

type TargetEnvironment = "preview" | "production";

interface CloudflareResponse<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
  result_info?: {
    page?: number;
    total_pages?: number;
  };
}

interface AccessApplication {
  id: string;
  name: string;
  domain?: string;
}

interface AccessPolicy {
  id: string;
  name: string;
  decision: string;
}

export interface SetupApiDocsAccessParams {
  environment: TargetEnvironment;
  accountId: string;
  apiToken: string;
  baseDomain: string;
  allowedEmails: readonly string[];
  fetch?: typeof globalThis.fetch;
}

function requireValue(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

export function parseAllowedEmails(value: string | undefined): string[] {
  const emails = [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  if (emails.length === 0) {
    throw new Error("CLOUDFLARE_ACCESS_ALLOWED_EMAILS must contain at least one email address");
  }

  const invalid = emails.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (invalid) {
    throw new Error(`Invalid email address in CLOUDFLARE_ACCESS_ALLOWED_EMAILS: ${invalid}`);
  }

  return emails;
}

export function resolveApiHostname(baseDomain: string): string {
  const normalized = baseDomain.trim().replace(/\/$/, "");
  const hostname = normalized.startsWith("http") ? new URL(normalized).hostname : normalized;
  return hostname.startsWith("api.") ? hostname : `api.${hostname}`;
}

function applicationName(environment: TargetEnvironment): string {
  return `me-builder-api-docs-${environment}`;
}

function applicationPayload(environment: TargetEnvironment, hostname: string) {
  const openApiDestination = `${hostname}/api/openapi.json`;
  return {
    name: applicationName(environment),
    type: "self_hosted",
    domain: openApiDestination,
    destinations: [
      { type: "public", uri: openApiDestination },
      { type: "public", uri: `${hostname}/api/docs` },
      { type: "public", uri: `${hostname}/api/docs/*` },
    ],
    session_duration: SESSION_DURATION,
    app_launcher_visible: false,
  };
}

function policyPayload(allowedEmails: readonly string[]) {
  return {
    name: POLICY_NAME,
    decision: "allow",
    include: allowedEmails.map((email) => ({ email: { email } })),
    exclude: [],
    require: [],
    precedence: 1,
    session_duration: SESSION_DURATION,
  };
}

function createApiClient(accountId: string, apiToken: string, fetchImpl: typeof globalThis.fetch) {
  return async function callApi<T>(
    path: string,
    init?: RequestInit,
  ): Promise<CloudflareResponse<T>> {
    const response = await fetchImpl(`${API_BASE}/accounts/${accountId}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    let body: CloudflareResponse<T>;
    try {
      body = (await response.json()) as CloudflareResponse<T>;
    } catch {
      throw new Error(`Cloudflare API returned a non-JSON response (${response.status})`);
    }

    if (!response.ok || !body.success) {
      const detail = body.errors?.map((error) => `${error.code}: ${error.message}`).join(", ");
      throw new Error(
        `Cloudflare API ${init?.method ?? "GET"} ${path} failed (${detail || response.status})`,
      );
    }

    return body;
  };
}

async function listAll<T>(callApi: ReturnType<typeof createApiClient>, path: string): Promise<T[]> {
  const result: T[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const separator = path.includes("?") ? "&" : "?";
    const body = await callApi<T[]>(`${path}${separator}page=${page}&per_page=50`);
    result.push(...body.result);
    totalPages = body.result_info?.total_pages ?? 1;
    page += 1;
  } while (page <= totalPages);

  return result;
}

export async function setupApiDocsAccess(params: SetupApiDocsAccessParams): Promise<void> {
  const accountId = requireValue("CLOUDFLARE_ACCOUNT_ID", params.accountId);
  const apiToken = requireValue("CLOUDFLARE_API_TOKEN", params.apiToken);
  const baseDomain = requireValue("BASE_DOMAIN", params.baseDomain);
  if (params.allowedEmails.length === 0) {
    throw new Error("At least one allowed email is required");
  }

  const callApi = createApiClient(accountId, apiToken, params.fetch ?? globalThis.fetch);
  const hostname = resolveApiHostname(baseDomain);
  const name = applicationName(params.environment);
  const applications = await listAll<AccessApplication>(callApi, "/access/apps");
  const matches = applications.filter((application) => application.name === name);
  if (matches.length > 1) {
    throw new Error(`Multiple Cloudflare Access applications named ${name} exist`);
  }

  const payload = applicationPayload(params.environment, hostname);
  const application = matches[0]
    ? (
        await callApi<AccessApplication>(`/access/apps/${matches[0].id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        })
      ).result
    : (
        await callApi<AccessApplication>("/access/apps", {
          method: "POST",
          body: JSON.stringify(payload),
        })
      ).result;

  const policies = await listAll<AccessPolicy>(callApi, `/access/apps/${application.id}/policies`);
  const unmanagedPolicies = policies.filter((policy) => policy.name !== POLICY_NAME);
  if (unmanagedPolicies.length > 0) {
    throw new Error(
      `Unmanaged policies exist on ${name}: ${unmanagedPolicies.map((policy) => policy.name).join(", ")}`,
    );
  }

  const managedPolicies = policies.filter((policy) => policy.name === POLICY_NAME);
  if (managedPolicies.length > 1) {
    throw new Error(`Multiple managed policies named ${POLICY_NAME} exist on ${name}`);
  }

  const policy = policyPayload(params.allowedEmails);
  if (managedPolicies[0]) {
    await callApi(`/access/apps/${application.id}/policies/${managedPolicies[0].id}`, {
      method: "PUT",
      body: JSON.stringify(policy),
    });
    console.info(`Updated Cloudflare Access for ${hostname} (${params.environment})`);
    return;
  }

  await callApi(`/access/apps/${application.id}/policies`, {
    method: "POST",
    body: JSON.stringify(policy),
  });
  console.info(`Created Cloudflare Access for ${hostname} (${params.environment})`);
}

async function main(): Promise<void> {
  const environment = process.argv[2];
  if (environment !== "preview" && environment !== "production") {
    throw new Error("Usage: bun scripts/setup-api-docs-access.ts <preview|production>");
  }

  await setupApiDocsAccess({
    environment,
    accountId: requireValue("CLOUDFLARE_ACCOUNT_ID", process.env.CLOUDFLARE_ACCOUNT_ID),
    apiToken: requireValue("CLOUDFLARE_API_TOKEN", process.env.CLOUDFLARE_API_TOKEN),
    baseDomain: requireValue("BASE_DOMAIN", process.env.BASE_DOMAIN),
    allowedEmails: parseAllowedEmails(process.env.CLOUDFLARE_ACCESS_ALLOWED_EMAILS),
  });
}

if (import.meta.main) {
  await main();
}
