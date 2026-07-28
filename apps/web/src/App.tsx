import { type ReactNode, useCallback, useEffect, useState } from "react";
import { SwipeSurvey } from "./components/swipe-survey";
import { config } from "./config";
import { type LiffSessionState, type LiffState, initializeLiff, verifyLiffSession } from "./liff";

interface ApiHealthResponse {
  status: string;
  environment: string;
  timestamp: string;
}

/** 稼働状態を示すバッジ。 */
function StatusBadge({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-sm font-medium text-emerald-400">
      <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
      {children}
    </div>
  );
}

/** サーバー側の本人確認（ID トークン検証）の状態を 1 行で表示します。 */
function SessionLine({ state }: { state: LiffSessionState }) {
  const text: Record<LiffSessionState["status"], string> = {
    idle: "",
    verifying: "本人確認中...",
    verified: "本人確認済み（サーバーで ID トークンを検証しました）",
    "friendship-required":
      "LINE 公式アカウントの友だち追加が必要です（アカウント作成の起点になります）",
    error: state.status === "error" ? state.message : "",
  };

  if (!text[state.status]) {
    return null;
  }

  return (
    <p className={`mt-3 text-sm ${state.status === "error" ? "text-red-400" : "text-slate-400"}`}>
      {text[state.status]}
    </p>
  );
}

/** LIFF の状態を、白画面にせず必ず何かを表示するためのカード。 */
function LiffCard({ state, session }: { state: LiffState; session: LiffSessionState }) {
  return (
    <div className="mt-6 rounded-xl border border-slate-700 bg-slate-900/60 p-6">
      <StatusBadge>LIFF ({state.status})</StatusBadge>

      {state.status === "loading" && <p>LIFF を初期化しています...</p>}

      {state.status === "disabled" && (
        <p className="text-slate-400">
          {`LIFF は無効です（${state.reason}）。LINE 内から開く導線を確認する場合は VITE_LIFF_ID を設定してください。`}
        </p>
      )}

      {state.status === "login-required" && <p>LINE のログイン画面へ移動しています...</p>}

      {state.status === "error" && <p className="text-red-400">{state.message}</p>}

      {state.status === "ready" && (
        <div className="flex items-center gap-3">
          {state.profile.pictureUrl && (
            <img
              src={state.profile.pictureUrl}
              alt=""
              width={48}
              height={48}
              className="rounded-full"
            />
          )}
          <div>
            <p>{state.profile.displayName}</p>
            <p className="text-sm text-slate-400">
              {state.inClient ? "LINE 内 (LIFF) で表示中" : "外部ブラウザで表示中"}
            </p>
          </div>
        </div>
      )}

      <SessionLine state={session} />
    </div>
  );
}

export function App() {
  const [healthData, setHealthData] = useState<ApiHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liffState, setLiffState] = useState<LiffState>({ status: "loading" });
  const [sessionState, setSessionState] = useState<LiffSessionState>({ status: "idle" });

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const apiEndpoint = config.apiUrl
        ? `${config.apiUrl.replace(/\/$/, "")}/api/health`
        : "/api/health";
      const res = await fetch(apiEndpoint);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      setHealthData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  useEffect(() => {
    let cancelled = false;
    initializeLiff(config.liffId)
      .then(async (state) => {
        if (cancelled) {
          return;
        }
        setLiffState(state);

        // 初期化に成功したときだけ、サーバー側で ID トークンを検証して Account を解決する
        if (state.status !== "ready") {
          return;
        }
        setSessionState({ status: "verifying" });
        const session = await verifyLiffSession(config.apiUrl);
        if (!cancelled) {
          setSessionState(session);
        }
      })
      .catch((err: unknown) => {
        // initializeLiff は失敗も状態として返すが、想定外の例外でも画面を白くしない。
        if (!cancelled) {
          setLiffState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-8">
      <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl shadow-black/30 sm:p-10">
        <h1 className="mb-6 bg-gradient-to-br from-sky-400 to-indigo-400 bg-clip-text text-4xl font-bold text-transparent">
          me-builder
        </h1>

        <SwipeSurvey />

        <section className="mt-10 border-t border-slate-700 pt-6">
          <h2 className="text-lg font-bold">接続状況</h2>
          <p className="mt-1 text-sm text-slate-400">
            Bun Workspace + Bun.serve (API) + React (UI) の開発用の表示です。
          </p>

          <LiffCard state={liffState} session={sessionState} />

          <div className="mt-6 rounded-xl border border-slate-700 bg-slate-900/60 p-6">
            <StatusBadge>API Server Link ({config.apiUrl || "local"})</StatusBadge>

            <div>
              <button
                type="button"
                onClick={fetchHealth}
                disabled={loading}
                className="rounded-lg bg-gradient-to-br from-sky-400 to-sky-600 px-6 py-3 font-semibold text-slate-900 transition hover:-translate-y-px hover:shadow-lg hover:shadow-sky-400/30 disabled:opacity-60"
              >
                {loading ? "通信中..." : "API Health Check 再実行"}
              </button>
            </div>

            {error && <p className="mt-4 text-red-400">API通信エラー: {error}</p>}

            {healthData && (
              <div className="mt-4">
                <p className="text-sm text-slate-400">レスポンス (GET /api/health):</p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-4 font-mono text-sm text-slate-200">
                  {JSON.stringify(healthData, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
