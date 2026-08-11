import { type ReactNode, createContext, useContext } from "react";
import { useLiffSessionState } from "./hooks/use-liff-session";

type LiffSession = ReturnType<typeof useLiffSessionState>;

const LiffSessionContext = createContext<LiffSession | null>(null);

/** LIFF SDKの初期化結果をアプリ全体で共有する。 */
export function LiffSessionProvider({ children }: { children: ReactNode }) {
  const session = useLiffSessionState();
  return <LiffSessionContext.Provider value={session}>{children}</LiffSessionContext.Provider>;
}

export function useLiffSession(): LiffSession {
  const sharedSession = useContext(LiffSessionContext);
  const fallbackSession = useLiffSessionState(sharedSession === null);
  return sharedSession ?? fallbackSession;
}
