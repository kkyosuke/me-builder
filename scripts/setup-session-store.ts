import { resolve } from "node:path";
import { parseEnvironment, resourceNames } from "../infra/src/environment";

type CloudflareResponse<T> = {
  success: boolean;
  result: T;
  errors?: { message?: string }[];
};

type SessionStore = { id: string; name: string };

export async function ensureSessionStore(input: {
  accountId: string;
  token: string;
  environment: "preview" | "production";
  fetcher?: typeof fetch;
}): Promise<SessionStore> {
  const fetcher = input.fetcher ?? fetch;
  const name = resourceNames(input.environment).sessionStore;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/storage/kv/namespaces`;
  const headers = { Authorization: `Bearer ${input.token}` };
  const listed = await cloudflareRequest<{ id: string; title: string }[]>(
    fetcher,
    `${endpoint}?per_page=1000`,
    { headers },
  );
  const existing = listed.find(({ title }) => title === name);
  if (existing) return { id: existing.id, name };

  const created = await cloudflareRequest<{ id: string; title: string }>(fetcher, endpoint, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ title: name }),
  });
  return { id: created.id, name };
}

async function cloudflareRequest<T>(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetcher(url, init);
  const body = (await response.json().catch(() => null)) as CloudflareResponse<T> | null;
  if (!response.ok || !body?.success) {
    const detail = body?.errors
      ?.map(({ message }) => message)
      .filter(Boolean)
      .join(", ");
    throw new Error(`Cloudflare KV API ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return body.result;
}

async function main(): Promise<void> {
  const environment = parseEnvironment(process.argv[2] ?? "");
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
  }
  const sessionStore = await ensureSessionStore({ accountId, token, environment });
  const manifestPath = resolve(import.meta.dir, `../infra/environments/${environment}.json`);
  const manifest = (await Bun.file(manifestPath).json()) as Record<string, unknown>;
  await Bun.write(manifestPath, `${JSON.stringify({ ...manifest, sessionStore }, null, 2)}\n`);
  console.info(`Session KV is ready: ${sessionStore.name}`);
}

if (import.meta.main) await main();
