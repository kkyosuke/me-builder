import { resolve } from "node:path";
import { parseEnvironment, resourceNames } from "../infra/src/environment";
import { type InfrastructureManifest, parseManifest } from "../infra/src/manifest";

type CloudflareResponse<T> = {
  success: boolean;
  result: T;
  errors?: { message?: string }[];
};

type VerificationInput = Readonly<{
  accountId: string;
  token: string;
  manifest: InfrastructureManifest;
  fetcher?: typeof fetch;
}>;

export async function verifyCloudflareInfrastructure(
  input: VerificationInput,
): Promise<Readonly<{ checks: string[] }>> {
  const fetcher = input.fetcher ?? fetch;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${input.accountId}`;
  const headers = { Authorization: `Bearer ${input.token}` };
  const expected = resourceNames(input.manifest.environment);

  const [databases, buckets, namespaces, queues, vectorize] = await Promise.all([
    cloudflareRequest<{ uuid: string; name: string }[]>(
      fetcher,
      `${endpoint}/d1/database?per_page=100`,
      headers,
    ),
    cloudflareRequest<{ buckets?: { name?: string }[] }>(
      fetcher,
      `${endpoint}/r2/buckets?per_page=1000&name_contains=${encodeURIComponent(expected.avatarBucket)}`,
      headers,
    ),
    cloudflareRequest<{ id: string; title: string }[]>(
      fetcher,
      `${endpoint}/storage/kv/namespaces?per_page=1000`,
      headers,
    ),
    cloudflareRequest<{ queue_id: string; queue_name: string }[]>(
      fetcher,
      `${endpoint}/queues?per_page=100`,
      headers,
    ),
    cloudflareRequest<{ name?: string; config?: { dimensions?: number; metric?: string } }>(
      fetcher,
      `${endpoint}/vectorize/v2/indexes/${encodeURIComponent(`me-builder-brain-${input.manifest.environment}`)}`,
      headers,
    ),
  ]);

  const database = databases.find(({ name }) => name === expected.database);
  assert(database, `D1 database is missing: ${expected.database}`);
  assert(
    database.uuid === input.manifest.database.id,
    `D1 database ID drifted: ${expected.database}`,
  );
  assert(
    buckets.buckets?.some(({ name }) => name === expected.avatarBucket),
    `R2 bucket is missing: ${expected.avatarBucket}`,
  );
  assert(
    namespaces.some(({ title }) => title === expected.sessionStore),
    `KV namespace is missing: ${expected.sessionStore}`,
  );

  const actualQueueNames = new Set(queues.map(({ queue_name }) => queue_name));
  for (const queueName of Object.values(expected.queues)) {
    assert(actualQueueNames.has(queueName), `Queue is missing: ${queueName}`);
  }

  const vectorizeName = `me-builder-brain-${input.manifest.environment}`;
  assert(vectorize.name === vectorizeName, `Vectorize index is missing: ${vectorizeName}`);
  assert(vectorize.config?.dimensions === 768, `Vectorize dimensions drifted: ${vectorizeName}`);
  assert(vectorize.config?.metric === "cosine", `Vectorize metric drifted: ${vectorizeName}`);

  for (const application of ["worker", "api", "mcp"] as const) {
    const scriptName = `me-builder-${application}-${input.manifest.environment}`;
    await cloudflareRequest<unknown>(
      fetcher,
      `${endpoint}/workers/scripts/${scriptName}/settings`,
      headers,
    );
  }

  return {
    checks: [
      "d1-manifest-id",
      "private-r2-bucket",
      "session-kv",
      "queue-set",
      "vectorize-schema",
      "worker-deployments",
    ],
  };
}

async function cloudflareRequest<T>(
  fetcher: typeof fetch,
  url: string,
  headers: HeadersInit,
): Promise<T> {
  const response = await fetcher(url, { headers, method: "GET" });
  const body = (await response.json().catch(() => null)) as CloudflareResponse<T> | null;
  if (!response.ok || !body?.success) {
    const detail = body?.errors
      ?.map(({ message }) => message)
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Cloudflare read-only verification failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  return body.result;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function main(): Promise<void> {
  const environment = parseEnvironment(process.argv[2] ?? "");
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
  }
  const manifest = parseManifest(
    await Bun.file(resolve(import.meta.dir, `../infra/environments/${environment}.json`)).json(),
  );
  const result = await verifyCloudflareInfrastructure({ accountId, token, manifest });
  console.info(`Cloudflare ${environment} drift check passed: ${result.checks.join(", ")}`);
}

if (import.meta.main) await main();
