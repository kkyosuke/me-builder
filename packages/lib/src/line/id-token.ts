import { logger } from "@me-builder/shared";

/**
 * LIFF / LINE Login の ID トークンを検証します。
 *
 * 検証は LINE の検証エンドポイント (`POST https://api.line.me/oauth2/v2.1/verify`) に
 * 委譲します。署名・`iss`・`exp` と、`client_id` に対する `aud` の一致は LINE 側で
 * 検証されるため、JWKS の取得と署名検証を自前で持ちません。
 *
 * クライアントが自称する `liff.getProfile()` の結果は信頼せず、必ずこの検証を通した
 * `sub` を本人の識別子として使います。
 *
 * ID トークン・アクセストークン・`sub` はログへ出力しません
 * ([プロジェクト概要 §8](../../../../docs/project-overview.md#8-プライバシーと安全性))。
 */

const VERIFY_ENDPOINT = "https://api.line.me/oauth2/v2.1/verify";

export type VerifyIdTokenParams = {
  /** クライアントから受け取った ID トークン */
  idToken: string;
  /** LINE Login チャネルの ID (`aud` の期待値) */
  channelId: string;
};

/** 検証済みのクレーム。表示に使えるのは `name` と `picture` だけです。 */
export type VerifiedIdToken = {
  /** LINE Login の userId。本人識別子なので画面表示もログ出力もしません */
  sub: string;
  name?: string;
  picture?: string;
};

export type VerifyIdTokenResult =
  | { ok: true; claims: VerifiedIdToken }
  | { ok: false; reason: string };

type VerifyResponse = {
  iss?: string;
  sub?: string;
  aud?: string;
  exp?: number;
  name?: string;
  picture?: string;
  error?: string;
  error_description?: string;
};

async function verify({ idToken, channelId }: VerifyIdTokenParams): Promise<VerifyIdTokenResult> {
  if (!idToken || !channelId) {
    return { ok: false, reason: "id_token または LINE Login チャネル ID が指定されていません" };
  }

  let body: VerifyResponse;
  try {
    const res = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    body = (await res.json()) as VerifyResponse;

    if (!res.ok) {
      // error_description には ID トークンそのものを含めない
      const reason = body.error ? `${body.error}` : `HTTP ${res.status}`;
      logger.warn({ reason }, "[LINE ID Token] 検証に失敗しました");
      return { ok: false, reason };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.name : "UnknownError";
    logger.warn({ reason }, "[LINE ID Token] 検証エンドポイントの呼び出しに失敗しました");
    return { ok: false, reason };
  }

  if (!body.sub) {
    return { ok: false, reason: "sub を取得できませんでした" };
  }

  // LINE 側でも検証されるが、aud の一致は受け取り側でも必ず確認する
  if (body.aud !== channelId) {
    logger.warn("[LINE ID Token] aud が LINE Login チャネル ID と一致しません");
    return { ok: false, reason: "aud が一致しません" };
  }

  return {
    ok: true,
    claims: {
      sub: body.sub,
      ...(body.name ? { name: body.name } : {}),
      ...(body.picture ? { picture: body.picture } : {}),
    },
  };
}

/**
 * LINE Login チャネル ID を解決します。
 *
 * LIFF ID は `{LINE Login チャネル ID}-{ランダム文字列}` の形式のため、
 * チャネル ID が未設定の場合は接頭辞から補完します。
 */
function resolveLoginChannelId(params: {
  channelId?: string | undefined;
  liffId?: string | undefined;
}): string | undefined {
  if (params.channelId) {
    return params.channelId;
  }
  const prefix = params.liffId?.split("-")[0];
  if (prefix && /^\d+$/.test(prefix)) {
    return prefix;
  }
  return undefined;
}

export const idToken: {
  verify: (params: VerifyIdTokenParams) => Promise<VerifyIdTokenResult>;
  resolveLoginChannelId: (params: {
    channelId?: string | undefined;
    liffId?: string | undefined;
  }) => string | undefined;
} = {
  verify,
  resolveLoginChannelId,
};
