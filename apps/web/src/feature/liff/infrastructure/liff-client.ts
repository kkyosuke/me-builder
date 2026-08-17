import liff from "@line/liff";
import { logger } from "@me-builder/shared";

export type LiffAuthExchangeInitialization =
  | { status: "disabled"; reason: string }
  | { status: "login-required"; inClient: boolean }
  | { status: "ready"; inClient: boolean }
  | { status: "error"; message: string };

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 認証交換境界だけが、初期化済みLIFF SDKからcredentialを読み出す。 */
export function readLiffAuthExchangeCredential(): string | null {
  try {
    return liff.getIDToken();
  } catch {
    logger.warn(
      { event: "liff.id-token.failed", outcome: "failed", reason: "sdk-error" },
      "ID トークンを取得できませんでした",
    );
    return null;
  }
}

/** 認証入口がLIFF/LINE Loginを選んだ場合だけログイン遷移を開始する。 */
export function redirectToLiffLogin(): void {
  liff.login();
}

/**
 * LIFFブラウザから外部URLをLINEのアプリ内ブラウザで開く。
 *
 * 外部ブラウザやLIFF SDKを利用できない状態ではfalseを返し、呼び出し側が通常の
 * Web navigationへ切り替えられるようにする。
 */
export function openLiffWindow(url: string): boolean {
  try {
    if (!liff.isInClient()) return false;
    liff.openWindow({ url, external: false });
    return true;
  } catch {
    logger.warn(
      { event: "liff.window.open.failed", outcome: "failed", reason: "sdk-error" },
      "LIFF から外部 URL を開けませんでした",
    );
    return false;
  }
}

/**
 * LIFFの共有先選択を開始する。利用できない場合は同期的にnullを返し、呼び出し側が
 * ユーザー操作の権限を失う前にWeb Share APIへ切り替えられるようにする。
 */
export function shareLiffTextMessage(text: string): Promise<"sent" | "cancelled"> | null {
  if (!liff.isApiAvailable("shareTargetPicker")) return null;
  return liff
    .shareTargetPicker([{ type: "text", text }], { isMultiple: false })
    .then((result) => (result ? "sent" : "cancelled"));
}

/**
 * 認証交換のためだけにLIFFを初期化し、ログイン状態を返します。
 *
 * - `liffId` が未設定なら初期化をスキップします（LIFF なしでも画面は動作します）
 * - 未ログインなら実行環境を含む `login-required` を返し、入口選択後にだけ遷移します
 * - 初期化の失敗は例外を投げず `status: "error"` として返します
 *
 * `liffId` は既定値を持たせず呼び出し側（`config.liffId`）から渡します。既定値にすると
 * `initializeLiffForAuthExchange(undefined)` が「未設定」を表現できず、環境変数の有無で挙動が変わります。
 */
export async function initializeLiffForAuthExchange(
  liffId: string | undefined,
): Promise<LiffAuthExchangeInitialization> {
  if (!liffId) {
    logger.info("VITE_LIFF_ID が未設定のため LIFF の初期化をスキップします");
    return { status: "disabled", reason: "VITE_LIFF_ID が未設定です" };
  }

  try {
    await liff.init({ liffId });
  } catch (error) {
    logger.warn(
      { event: "liff.initialize.failed", outcome: "failed", reason: "sdk-error" },
      "LIFF の初期化に失敗しました",
    );
    return { status: "error", message: `LIFF の初期化に失敗しました: ${toMessage(error)}` };
  }

  const inClient = liff.isInClient();

  if (!liff.isLoggedIn()) {
    logger.info(`LIFF が未ログインです (inClient: ${inClient})`);
    return { status: "login-required", inClient };
  }

  logger.info(`LIFF の認証交換準備に成功しました (inClient: ${inClient})`);
  return { status: "ready", inClient };
}
