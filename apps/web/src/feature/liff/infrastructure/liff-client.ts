import liff from "@line/liff";
import { logger } from "@me-builder/shared";
import type { LiffState } from "../model/types";

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 初期化済みのLIFF SDKから、API認証に使うIDトークンを取得する。 */
export function getLiffIdToken(): string | null {
  try {
    return liff.getIDToken();
  } catch (error) {
    logger.warn(`ID トークンを取得できませんでした: ${toMessage(error)}`);
    return null;
  }
}

/** LIFFの共有先選択を開き、LINEの友だちへテキストを送れる場合だけtrueを返す。 */
export async function shareLiffTextMessage(text: string): Promise<boolean> {
  if (!liff.isApiAvailable("shareTargetPicker")) return false;
  await liff.shareTargetPicker([{ type: "text", text }]);
  return true;
}

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
