import { logger } from "@me-builder/shared";

/**
 * LIFF / LINE Login の ID トークンを検証します。
 *
 * 検証は LINE の検証エンドポイント (`POST https://api.line.me/oauth2/v2.1/verify`) に
 * 委譲します。署名・`iss`・`exp` と、`client_id` に対する `aud` の一致は LINE 側で
 * 検証されるため、JWKS の取得と署名検証を自前で持ちません。
 *
 * `liff.getProfile()` が返す値そのものは LINE から取得した本物ですが、**クライアント経由で
 * 送られてきた値はサーバー側で検証できません**（LINE の API が返した値の転送なのか、手で
 * 書かれた値なのか区別が付かない）。そのため本人の識別子には必ずこの検証を通した `sub` を
 * 使い、送られてきた `userId` を識別子として受け付けません。
 *
 * ID トークン・アクセストークン・`sub` はログへ出力しません
 * ([プロジェクト概要 §8](../../../../docs/project-overview.md#8-プライバシーと安全性))。
 */

const VERIFY_ENDPOINT = "https://api.line.me/oauth2/v2.1/verify";

/**
 * 受け入れる ID トークンの最大経過時間（秒）の既定値。
 *
 * LIFF の ID トークンは発行から 1 時間有効なので、既定はそれに合わせています
 * （LINE 側の検証より厳しくしない）。**LIFF は `nonce` を指定できない**ため
 * （`liff.login()` に nonce のパラメータがない）、リプレイを nonce で防げません。
 * 代わりにこの上限を絞ることで、漏れたトークンが使える時間を短くできます。
 *
 * 絞る前に実際の `iat` の分布を確認できるよう、検証成功時にトークンの経過秒数を
 * ログへ出力します（トークン本体は出力しません）。
 */
const DEFAULT_MAX_AGE_SECONDS = 60 * 60;

export type VerifyIdTokenParams = {
  /** クライアントから受け取った ID トークン */
  idToken: string;
  /** LINE Login チャネルの ID (`aud` の期待値) */
  channelId: string;
  /** 受け入れる発行からの最大経過時間（秒）。既定は 3600 */
  maxAgeSeconds?: number | undefined;
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
  /** 発行時刻 (UNIX 秒) */
  iat?: number;
  name?: string;
  picture?: string;
  error?: string;
  error_description?: string;
};

async function verify({
  idToken,
  channelId,
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
}: VerifyIdTokenParams): Promise<VerifyIdTokenResult> {
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

  // 発行からの経過時間を確認する。exp は LINE 側で検証されるが、
  // nonce を使えない分、受け入れる期間を自分で絞れるようにしておく。
  if (body.iat !== undefined) {
    const ageSeconds = Math.floor(Date.now() / 1000) - body.iat;
    if (ageSeconds > maxAgeSeconds) {
      logger.warn({ ageSeconds, maxAgeSeconds }, "[LINE ID Token] 発行から時間が経ちすぎています");
      return { ok: false, reason: "ID トークンが古すぎます" };
    }
    // 上限を絞る判断材料として経過時間だけ残す (トークン本体は出力しない)
    logger.info({ ageSeconds }, "[LINE ID Token] 検証に成功しました");
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
