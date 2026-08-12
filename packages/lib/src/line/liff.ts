import { logger } from "@me-builder/shared";
import { resolveLiffConfiguration } from "./configuration";

/**
 * LIFF アプリのエンドポイント URL を LIFF Server API 経由で登録・更新します。
 *
 * Webhook Endpoint URL の自動登録 (`line.webhook.register`) と同じ位置づけで、
 * デプロイのたびに「今デプロイした URL」を LIFF アプリへ反映させるために使います。
 *
 * LIFF Server API は **LINE Login チャネル** のチャネルアクセストークンを要求します
 * (Messaging API チャネルのトークンでは操作できません)。トークンは client credentials で
 * 発行し、有効期間の短いステートレストークンを優先します。
 *
 * トークンおよびチャネルシークレットはログへ出力しません。
 */

const LIFF_API_BASE = "https://api.line.me/liff/v1/apps";

/** ステートレス (15分) を優先し、失敗した場合は短命 (30日) のエンドポイントへフォールバックします。 */
const TOKEN_ENDPOINTS = [
  "https://api.line.me/oauth2/v3/token",
  "https://api.line.me/v2/oauth/accessToken",
] as const;

/**
 * LIFF アプリに必要な scope。
 *
 * - `profile`: `liff.getProfile()` で表示名とアイコンを取得する
 * - `openid`: **`liff.getIDToken()` で ID トークンを取得する。これが無いと ID トークンを
 *   取得できず、サーバー側で本人性を検証できません**
 *   （[LIFF リファレンス](https://developers.line.biz/en/reference/liff/#get-id-token)）
 */
const REQUIRED_SCOPES = ["openid", "profile"] as const;

/** LIFF アプリのビューのサイズ。 */
export type LiffViewType = "compact" | "tall" | "full";

export type RegisterLiffEndpointParams = {
  /** LINE Login チャネルの ID (client_id)。未指定なら liffId の接頭辞から補完します */
  channelId?: string | undefined;
  /** LINE Login チャネルのチャネルシークレット (client_secret) */
  channelSecret?: string | undefined;
  /** 更新対象の LIFF ID。未指定の場合は description で突き合わせます */
  liffId?: string | undefined;
  /** LIFF アプリへ設定するエンドポイント URL (https) */
  endpointUrl?: string | undefined;
  /** LIFF アプリの識別に使う名前。liffId 未指定時の突き合わせキーにもなります */
  description: string;
  /** ビューのサイズ (既定: full) */
  viewType?: LiffViewType;
};

export type RegisterLiffEndpointResult = {
  success: boolean;
  message: string;
  /** 更新または作成した LIFF アプリの LIFF ID */
  liffId?: string;
};

type LiffApp = {
  liffId: string;
  description?: string;
  view?: { type?: string; url?: string };
  scope?: string[];
};

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 既存の LIFF アプリが要求どおりの設定かどうかを判定します。
 *
 * 一覧 API が `scope` を返さない場合は判定できないため「揃っていない」とみなし、更新を実行します
 * （更新は冪等なので余分に 1 回 API を呼ぶだけで済みます）。
 */
function isUpToDate(app: LiffApp, endpointUrl: string, viewType: LiffViewType): boolean {
  const viewMatches = app.view?.url === endpointUrl && app.view?.type === viewType;
  const scopeMatches =
    Array.isArray(app.scope) && REQUIRED_SCOPES.every((scope) => app.scope?.includes(scope));
  return viewMatches && scopeMatches;
}

/** チャネル ID を解決します。未設定なら LIFF ID の接頭辞から補完します。 */
function resolveChannelId(params: RegisterLiffEndpointParams): string | undefined {
  if (!params.channelId) {
    logger.info(
      "[LIFF] LINE_LOGIN_CHANNEL_ID が未設定のため LIFF ID の接頭辞をチャネル ID として使用します",
    );
  }
  return resolveLiffConfiguration({
    liffId: params.liffId,
    lineLoginChannelId: params.channelId,
  }).lineLoginChannelId;
}

/** client credentials で LINE Login チャネルのチャネルアクセストークンを発行します。 */
async function issueChannelAccessToken(channelId: string, channelSecret: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: channelId,
    client_secret: channelSecret,
  });

  const failures: string[] = [];
  for (const endpoint of TOKEN_ENDPOINTS) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (res.ok) {
      const json = (await res.json()) as { access_token?: string };
      if (json.access_token) {
        // どのエンドポイントで発行できたかを残す。短命トークンはチャネルあたり
        // 30 個の上限があるため、フォールバックが常用されていないか確認できるようにする。
        logger.info(`[LIFF] チャネルアクセストークンを発行しました (${endpoint})`);
        return json.access_token;
      }
      failures.push(`${endpoint}: response has no access_token`);
      continue;
    }
    // トークンエンドポイントのレスポンス本文は転記しない (認証情報が混ざる経路を作らない)
    failures.push(`${endpoint}: HTTP ${res.status}`);
  }

  throw new Error(`チャネルアクセストークンを発行できませんでした (${failures.join(" / ")})`);
}

async function callLiffApi(
  token: string,
  path: string,
  init?: { method: string; body?: string },
): Promise<unknown> {
  const res = await fetch(`${LIFF_API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(init?.body ? { body: init.body } : {}),
  });

  if (!res.ok) {
    throw new Error(
      `LIFF Server API ${init?.method ?? "GET"} ${path} failed: ${res.status} ${(
        await res.text()
      ).slice(0, 200)}`,
    );
  }

  // 204 など本文が無い場合もあるため、パースできなければ undefined を返す
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

/**
 * LIFF アプリのエンドポイント URL を登録・更新します。
 *
 * - 必要な設定 (チャネル ID / シークレット / URL) が欠けている場合は安全にスキップします
 * - `liffId` が一致するアプリ、無ければ `description` が一致するアプリを更新します
 * - どちらも見つからない場合は新規作成し、発行された LIFF ID をログへ出力します
 */
async function registerEndpoint(
  params: RegisterLiffEndpointParams,
): Promise<RegisterLiffEndpointResult> {
  const { channelSecret, endpointUrl, description } = params;
  const viewType: LiffViewType = params.viewType ?? "full";

  try {
    const channelId = resolveChannelId(params);
    if (!channelId || !channelSecret || !endpointUrl) {
      const msg =
        "[LIFF] LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET / エンドポイント URL が設定されていないため、LIFF アプリの自動設定をスキップします。";
      logger.info(msg);
      return { success: false, message: msg };
    }
    const token = await issueChannelAccessToken(channelId, channelSecret);

    const listed = (await callLiffApi(token, "")) as { apps?: LiffApp[] } | undefined;
    const apps = listed?.apps ?? [];
    const target =
      apps.find((app) => params.liffId && app.liffId === params.liffId) ??
      apps.find((app) => app.description === description);

    if (target) {
      if (isUpToDate(target, endpointUrl, viewType)) {
        const msg = `[LIFF] LIFF アプリの設定は既に一致しています: ${endpointUrl} (${target.liffId})`;
        logger.info(msg);
        return { success: true, message: msg, liffId: target.liffId };
      }

      // scope も毎回送る。openid が欠けていると ID トークンを取得できないため、
      // 手でスコープを外された状態を次のデプロイで復旧できるようにする。
      await callLiffApi(token, `/${target.liffId}`, {
        method: "PUT",
        body: JSON.stringify({
          view: { type: viewType, url: endpointUrl },
          description,
          scope: [...REQUIRED_SCOPES],
        }),
      });
      const msg = `[LIFF] LIFF アプリの設定を更新しました: ${endpointUrl} scope=${REQUIRED_SCOPES.join(",")} (${target.liffId})`;
      logger.info(msg);
      return { success: true, message: msg, liffId: target.liffId };
    }

    const created = (await callLiffApi(token, "", {
      method: "POST",
      body: JSON.stringify({
        view: { type: viewType, url: endpointUrl },
        description,
        scope: [...REQUIRED_SCOPES],
      }),
    })) as { liffId?: string } | undefined;

    if (!created?.liffId) {
      throw new Error("LIFF アプリを作成しましたが LIFF ID を取得できませんでした");
    }

    const msg = `[LIFF] LIFF アプリを新規作成しました: ${endpointUrl} (LIFF ID: ${created.liffId})`;
    logger.info(msg);
    return { success: true, message: msg, liffId: created.liffId };
  } catch (error) {
    // 万一エラー文へ混ざっても外へ出さないよう、チャネルシークレットは伏せる
    const detail = channelSecret
      ? toMessage(error).replaceAll(channelSecret, "***")
      : toMessage(error);
    const msg = `[LIFF] LIFF アプリの自動設定に失敗しました: ${detail}`;
    logger.error(msg);
    return { success: false, message: msg };
  }
}

export const liff: {
  registerEndpoint: (params: RegisterLiffEndpointParams) => Promise<RegisterLiffEndpointResult>;
  resolveConfiguration: typeof resolveLiffConfiguration;
} = {
  registerEndpoint,
  resolveConfiguration: resolveLiffConfiguration,
};
