import { useCallback, useEffect, useState } from "react";
import { config } from "./config";
import { type LiffState, initializeLiff } from "./liff";

interface ApiHealthResponse {
  status: string;
  environment: string;
  timestamp: string;
}

/** LIFF の状態を、白画面にせず必ず何かを表示するためのカード。 */
function LiffCard({ state }: { state: LiffState }) {
  return (
    <div className="card">
      <div className="status-badge">
        <span className="status-dot" />
        LIFF ({state.status})
      </div>

      {state.status === "loading" && <p>LIFF を初期化しています...</p>}

      {state.status === "disabled" && (
        <p style={{ color: "var(--text-muted)" }}>
          {`LIFF は無効です（${state.reason}）。LINE 内から開く導線を確認する場合は VITE_LIFF_ID を設定してください。`}
        </p>
      )}

      {state.status === "login-required" && <p>LINE のログイン画面へ移動しています...</p>}

      {state.status === "error" && <p style={{ color: "#f87171" }}>{state.message}</p>}

      {state.status === "ready" && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {state.profile.pictureUrl && (
            <img
              src={state.profile.pictureUrl}
              alt=""
              width={48}
              height={48}
              style={{ borderRadius: "50%" }}
            />
          )}
          <div>
            <p style={{ margin: 0 }}>{state.profile.displayName}</p>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-muted)" }}>
              {state.inClient ? "LINE 内 (LIFF) で表示中" : "外部ブラウザで表示中"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function App() {
  const [healthData, setHealthData] = useState<ApiHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liffState, setLiffState] = useState<LiffState>({ status: "loading" });

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
      .then((state) => {
        if (!cancelled) {
          setLiffState(state);
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
    <div className="container">
      <h1>me-builder Workspace</h1>
      <p className="description">Bun Workspace + Bun.serve (API) + React (UI) の開発準備完了</p>

      <LiffCard state={liffState} />

      <div className="card">
        <div className="status-badge">
          <span className="status-dot" />
          API Server Link ({config.apiUrl || "local"})
        </div>

        <div>
          <button type="button" onClick={fetchHealth} disabled={loading}>
            {loading ? "通信中..." : "API Health Check 再実行"}
          </button>
        </div>

        {error && <p style={{ color: "#f87171", marginTop: "1rem" }}>API通信エラー: {error}</p>}

        {healthData && (
          <div style={{ marginTop: "1rem" }}>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              レスポンス (GET /api/health):
            </p>
            <pre>{JSON.stringify(healthData, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
