/**
 * 画面へ表示してよいプロフィール項目だけを持つ。
 * LINEのuserIdは本人識別子のため含めない。
 */
interface LiffDisplayProfile {
  displayName: string;
  pictureUrl?: string;
}

/** LIFF初期化の結果。失敗やスキップも画面表示可能な状態として表現する。 */
export type LiffState =
  | { status: "loading" }
  | { status: "disabled"; reason: string }
  | { status: "login-required" }
  | { status: "ready"; inClient: boolean; profile: LiffDisplayProfile }
  | { status: "error"; message: string };

/** API側でIDトークンを検証した結果。 */
export type LiffSessionState =
  | { status: "idle" }
  | { status: "verifying" }
  | { status: "verified" }
  | { status: "friendship-required" }
  | { status: "error"; message: string };
