import { type ReactNode, createContext, useContext } from "react";
import { useLiffSessionState } from "./hooks/use-liff-session";

type LiffSession = ReturnType<typeof useLiffSessionState>;

const LiffSessionContext = createContext<LiffSession | null>(null);

/**
 * LIFF SDKはページ全体で1つのため、初期化Promiseと状態も全featureで共有する。
 * featureごとにliff.init()を並行実行するとprimary redirectの処理が競合する。
 */
export function LiffSessionProvider({ children }: { children: ReactNode }) {
  const session = useLiffSessionState();
  return <LiffSessionContext.Provider value={session}>{children}</LiffSessionContext.Provider>;
}

export function useLiffSession(): LiffSession {
  const sharedSession = useContext(LiffSessionContext);
  // Provider外で単体表示するfeature/testだけは、自身でLIFFを初期化できるようにする。
  const fallbackSession = useLiffSessionState(sharedSession === null);
  return sharedSession ?? fallbackSession;
}
