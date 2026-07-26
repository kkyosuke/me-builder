/**
 * Cloudflare Pages のカスタムドメインを登録し、DNS の CNAME レコードまで作成します。
 *
 * Pages はドメインをプロジェクトへ登録するだけでは配信を開始せず、DNS レコードが
 * 揃うまで "Verifying"（Complete DNS setup）のまま止まります。Workers 側の
 * `custom_domain = true` はレコードを自動作成しますが、Pages にはその仕組みが
 * ないため、このスクリプトで API から作成します。
 *
 *   bun scripts/setup-pages-domain.ts <preview|production>
 *
 * 必要な環境変数:
 *   - CLOUDFLARE_ACCOUNT_ID
 *   - CLOUDFLARE_API_TOKEN  (Pages:Edit / Zone:Read / DNS:Edit)
 *   - BASE_DOMAIN           (例: stg.kagami.kyosuke.dev)
 *
 * デプロイを止めないため、失敗しても終了コードは 0 のままにし、警告だけを出します。
 */

const API_BASE = "https://api.cloudflare.com/client/v4";
const PROJECT_NAME = "me-builder-web";

/** preview はブランチエイリアスを指し、production はプロジェクト既定のホストを指します。 */
const CNAME_TARGETS = {
  preview: `preview.${PROJECT_NAME}.pages.dev`,
  production: `${PROJECT_NAME}.pages.dev`,
} as const;

interface CloudflareResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

interface Zone {
  id: string;
  name: string;
}

interface DnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
}

function warn(message: string): void {
  console.warn(`⚠️  ${message}`);
}

async function callApi<T>(
  path: string,
  init?: RequestInit,
): Promise<CloudflareResponse<T> | undefined> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = (await res.json()) as CloudflareResponse<T>;
  if (!body.success) {
    const detail = body.errors?.map((e) => `${e.code}: ${e.message}`).join(", ") ?? res.statusText;
    warn(`Cloudflare API ${init?.method ?? "GET"} ${path} failed (${detail})`);
    return undefined;
  }
  return body;
}

/** ドメインを後ろから縮めながら、所有している Zone を探します。 */
async function findZone(domain: string): Promise<Zone | undefined> {
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    const body = await callApi<Zone[]>(`/zones?name=${encodeURIComponent(candidate)}`);
    const zone = body?.result?.[0];
    if (zone) {
      return zone;
    }
  }
  return undefined;
}

async function registerPagesDomain(accountId: string, domain: string): Promise<void> {
  const body = await callApi<{ name: string }>(
    `/accounts/${accountId}/pages/projects/${PROJECT_NAME}/domains`,
    { method: "POST", body: JSON.stringify({ name: domain }) },
  );
  // 既に登録済みの場合も API はエラーを返すため、警告だけ出して続行します。
  if (body) {
    console.log(`✅ Registered ${domain} on Pages project ${PROJECT_NAME}`);
  } else {
    console.log(`- ${domain} is already registered on ${PROJECT_NAME} (or registration skipped)`);
  }
}

async function upsertCname(zone: Zone, domain: string, target: string): Promise<void> {
  const existing = await callApi<DnsRecord[]>(
    `/zones/${zone.id}/dns_records?name=${encodeURIComponent(domain)}`,
  );
  const record = existing?.result?.[0];

  if (record?.type === "CNAME" && record.content === target) {
    console.log(`- DNS CNAME ${domain} → ${target} is already up-to-date`);
    return;
  }

  const payload = JSON.stringify({
    type: "CNAME",
    name: domain,
    content: target,
    proxied: true,
    comment: `Managed by scripts/setup-pages-domain.ts (${PROJECT_NAME})`,
  });

  if (record) {
    const updated = await callApi<DnsRecord>(`/zones/${zone.id}/dns_records/${record.id}`, {
      method: "PUT",
      body: payload,
    });
    if (updated) {
      console.log(`✅ Updated DNS ${record.type} ${domain} → CNAME ${target}`);
    }
    return;
  }

  const created = await callApi<DnsRecord>(`/zones/${zone.id}/dns_records`, {
    method: "POST",
    body: payload,
  });
  if (created) {
    console.log(`✅ Created DNS CNAME ${domain} → ${target}`);
  }
}

async function main(): Promise<void> {
  const targetEnv = process.argv[2];
  if (targetEnv !== "preview" && targetEnv !== "production") {
    warn("Usage: bun scripts/setup-pages-domain.ts <preview|production>");
    return;
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const domain = process.env.BASE_DOMAIN;

  if (!accountId || !process.env.CLOUDFLARE_API_TOKEN) {
    warn(
      "CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN が未設定のため、ドメイン設定をスキップします",
    );
    return;
  }
  if (!domain) {
    warn("BASE_DOMAIN が未設定のため、ドメイン設定をスキップします");
    return;
  }

  const target = CNAME_TARGETS[targetEnv];
  console.log(`Setting up Pages domain: ${domain} → ${target} (${targetEnv})`);

  await registerPagesDomain(accountId, domain);

  const zone = await findZone(domain);
  if (!zone) {
    warn(
      `${domain} を含む Zone が見つかりませんでした。CLOUDFLARE_API_TOKEN に Zone:Read / DNS:Edit の権限があるか確認してください`,
    );
    return;
  }
  console.log(`Found zone ${zone.name} (${zone.id})`);

  await upsertCname(zone, domain, target);
}

main().catch((err) => {
  // デプロイ自体は成功しているため、DNS 設定の失敗ではワークフローを落としません。
  warn(`Unhandled error while setting up the Pages domain: ${err}`);
});
