export type AuthFailureReason =
  | "account-not-found"
  | "configuration"
  | "credential-rejected"
  | "network"
  | "session-expired"
  | "unknown";

/** 認証交換後に画面へ表示してよい情報。Account IDやprovider subjectは含めない。 */
export interface AuthDisplayProfile {
  displayName?: string | undefined;
  pictureUrl?: string | undefined;
}

export type AuthState =
  | { status: "checking" }
  | { status: "redirecting" }
  | {
      status: "authenticated";
      profile: AuthDisplayProfile;
      role: "user" | "admin";
      /** Account切替時に画面内cacheを破棄するための、provider非依存なローカル世代。 */
      revision: number;
    }
  | { status: "unauthenticated"; reason?: AuthFailureReason }
  | { status: "error"; reason: AuthFailureReason; message: string };
