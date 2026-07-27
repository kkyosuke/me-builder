import liff from "@line/liff";
import { logger } from "@me-builder/shared";

/**
 * 画面へ表示してよいプロフィール項目だけを持つ型。
 *
 * LINE の `userId` は本人識別子のため、画面表示もログ出力も行いません。
 * 詳細は [プロジェクト概要 §8](../../../../docs/project-overview.md#8-プライバシーと安全性) を参照してください。
 */
interface LiffDisplayProfile {
  displayName: string;
  pictureUrl?: string;
}

/**
 * LIFF 初期化の結果。どの状態でも画面を描画できるようにするため、
 * 失敗やスキップも例外ではなく状態として表現します。
 */
export type LiffState =
  /** 初期化中 */
  | { status: "loading" }
  /** `VITE_LIFF_ID` が未設定のため初期化をスキップした */
  | { status: "disabled"; reason: string }
  /** 未ログインのため LINE のログイン画面へ遷移した */
  | { status: "login-required" }
  /** 初期化とプロフィール取得に成功した */
  | { status: "ready"; inClient: boolean; profile: LiffDisplayProfile }
  /** 初期化またはプロフィール取得に失敗した */
  | { status: "error"; message: string };

/** API 側で ID トークンを検証した結果。 */
export type LiffSessionState =
  | { status: "idle" }
  | { status: "verifying" }
  /** 検証に成功し Account が解決できた */
  | { status: "verified" }
  /** 友だち追加がまだで Account が無い */
  | { status: "friendship-required" }
  | { status: "error"; message: string };

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * LIFF を初期化し、ログイン状態に応じた表示用の状態を返します。
 *
 * - `liffId` が未設定なら初期化をスキップします（LIFF なしでも画面は動作します）
 * - 未ログインなら `liff.login()` でログイン画面へ遷移します
 * - 初期化・プロフィール取得の失敗は例外を投げず `status: "error"` として返します
 *
 * `liffId` は既定値を持たせず呼び出し側（`config.liffId`）から渡します。既定値にすると
 * `initializeLiff(undefined)` が「未設定」を表現できず、環境変数の有無で挙動が変わります。
 */
export async function initializeLiff(liffId: string | undefined): Promise<LiffState> {
  if (!liffId) {
    logger.info("VITE_LIFF_ID が未設定のため LIFF の初期化をスキップします");
    return { status: "disabled", reason: "VITE_LIFF_ID が未設定です" };
  }

  try {
    await liff.init({ liffId });
  } catch (error) {
    logger.warn(`LIFF の初期化に失敗しました: ${toMessage(error)}`);
    return { status: "error", message: `LIFF の初期化に失敗しました: ${toMessage(error)}` };
  }

  const inClient = liff.isInClient();

  if (!liff.isLoggedIn()) {
    logger.info(`LIFF が未ログインのためログイン画面へ遷移します (inClient: ${inClient})`);
    liff.login();
    return { status: "login-required" };
  }

  try {
    const profile = await liff.getProfile();
    logger.info(`LIFF の初期化とプロフィール取得に成功しました (inClient: ${inClient})`);
    return {
      status: "ready",
      inClient,
      // userId と statusMessage は意図的に含めません。
      profile: {
        displayName: profile.displayName,
        ...(profile.pictureUrl ? { pictureUrl: profile.pictureUrl } : {}),
      },
    };
  } catch (error) {
    logger.warn(`LIFF のプロフィール取得に失敗しました: ${toMessage(error)}`);
    return { status: "error", message: `プロフィールの取得に失敗しました: ${toMessage(error)}` };
  }
}

/**
 * ID トークンを API へ送り、サーバー側で本人性を検証して Account を解決させます。
 *
 * `liff.getProfile()` の結果は画面表示には使いますが（嘘をつけても自分の画面の表示が
 * 変わるだけ）、Account の解決には使いません。サーバーはクライアントから送られた値を
 * 検証できないため、識別子は署名付きの ID トークンで渡します。トークンはログへ出力しません。
 */
export async function verifyLiffSession(apiUrl: string | undefined): Promise<LiffSessionState> {
  let token: string | null;
  try {
    token = liff.getIDToken();
  } catch (error) {
    logger.warn(`ID トークンを取得できませんでした: ${toMessage(error)}`);
    return { status: "error", message: "ID トークンを取得できませんでした" };
  }

  if (!token) {
    // openid スコープが無い場合、liff.getIDToken() は null を返す
    // https://developers.line.biz/en/reference/liff/#get-id-token
    logger.warn("ID トークンが取得できません。LIFF アプリの openid スコープを確認してください");
    return {
      status: "error",
      message: "ID トークンを取得できませんでした（LIFF アプリの openid スコープが必要です）",
    };
  }

  const endpoint = `${(apiUrl ?? "").replace(/\/$/, "")}/api/line/liff/session`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });

    if (res.status === 404) {
      logger.info("LINE Login の識別子に対応する Account がありません");
      return { status: "friendship-required" };
    }
    if (!res.ok) {
      logger.warn(`ID トークンの検証に失敗しました (HTTP ${res.status})`);
      return { status: "error", message: `本人確認に失敗しました (HTTP ${res.status})` };
    }

    logger.info("ID トークンの検証に成功しました");
    return { status: "verified" };
  } catch (error) {
    logger.warn(`ID トークンの検証リクエストに失敗しました: ${toMessage(error)}`);
    return { status: "error", message: "本人確認のリクエストに失敗しました" };
  }
}
