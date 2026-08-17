import { type ReactNode, createContext } from "react";
import { LiffSessionProvider } from "../../liff";
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

/** provider非依存sessionを共有しつつ、移行期間だけ既存LIFF contextも内包する。 */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return (
    <LiffSessionProvider>
      <AuthSessionBridge>{children}</AuthSessionBridge>
    </LiffSessionProvider>
  );
}
