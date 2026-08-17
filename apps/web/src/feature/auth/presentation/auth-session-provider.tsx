import { type ReactNode, createContext, useContext } from "react";
import type { AuthState } from "../model/auth-state";
import { useAuthSessionState } from "./use-auth-session";

type AuthSessionContextValue = {
  state: AuthState;
  retry(): Promise<AuthState>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

function AuthSessionBridge({ children }: { children: ReactNode }) {
  const session = useAuthSessionState();
  return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>;
}

/** provider非依存のapplication sessionをアプリ全体へ共有する。 */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return <AuthSessionBridge>{children}</AuthSessionBridge>;
}

export function useAuthSession(): AuthSessionContextValue {
  const session = useContext(AuthSessionContext);
  if (!session) throw new Error("useAuthSession must be used within AuthSessionProvider");
  return session;
}
