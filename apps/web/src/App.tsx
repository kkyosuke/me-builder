import { useCallback, useEffect, useState } from "react";

interface ApiHealthResponse {
  status: string;
  environment: string;
  timestamp: string;
}

export function App() {
  const [healthData, setHealthData] = useState<ApiHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/health");
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

  return (
    <div className="container">
      <h1>me-builder Workspace</h1>
      <p className="description">Bun Workspace + Bun.serve (API) + React (UI) の開発準備完了</p>

      <div className="card">
        <div className="status-badge">
          <span className="status-dot" />
          API Server Link
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
