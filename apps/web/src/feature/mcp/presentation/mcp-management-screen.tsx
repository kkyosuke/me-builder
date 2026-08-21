import { ArrowLeft, RefreshCw, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AsyncState } from "../../../model/async-state";
import {
  type McpAuditRecord,
  type McpConnection,
  fetchMcpAudit,
  fetchMcpConnections,
  revokeMcpConnection,
} from "../infrastructure/mcp-api";

type Data = { connections: McpConnection[]; records: McpAuditRecord[] };

export function McpManagementScreen({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<AsyncState<Data>>({ status: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const load = useCallback(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void Promise.all([fetchMcpConnections(controller.signal), fetchMcpAudit(controller.signal)])
      .then(([connections, audit]) =>
        setState({
          status: "success",
          data: { connections: connections.connections, records: audit.records },
        }),
      )
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "MCP情報を取得できませんでした。",
          });
      });
    return () => controller.abort();
  }, []);
  useEffect(load, []);

  const revoke = async (id: string) => {
    if (!window.confirm("このMCP接続を解除しますか？取得済み情報はclientから削除されません。"))
      return;
    setActionError(null);
    setRevokingId(id);
    try {
      await revokeMcpConnection(id);
      load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "MCP接続を解除できませんでした。");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="mcp-management-title"
      className="fixed inset-0 z-[70] m-0 h-auto max-h-none w-auto max-w-none overflow-y-auto border-0 bg-slate-50 p-0 dark:bg-slate-900"
    >
      <header className="sticky top-0 border-b border-slate-200 bg-white/95 dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex min-h-16 max-w-2xl items-center px-4">
          <button
            type="button"
            onClick={onBack}
            aria-label="プロフィールへ戻る"
            className="flex size-11 items-center justify-center rounded-full"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 id="mcp-management-title" className="ml-2 text-lg font-bold">
            MCP連携
          </h1>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 pb-16">
        {actionError && (
          <p role="alert" className="mb-4 text-rose-700 dark:text-rose-300">
            {actionError}
          </p>
        )}
        {state.status === "loading" && <p>読み込んでいます...</p>}
        {state.status === "error" && (
          <div>
            <p role="alert" className="text-rose-700 dark:text-rose-300">
              {state.message}
            </p>
            <button
              type="button"
              onClick={load}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border px-4"
            >
              <RefreshCw className="size-4" />
              再試行
            </button>
          </div>
        )}
        {state.status === "success" && (
          <>
            <section>
              <h2 className="text-base font-bold">接続履歴</h2>
              <div className="mt-3 space-y-3">
                {state.data.connections.length === 0 && (
                  <p className="text-sm text-slate-500">接続はありません。</p>
                )}
                {state.data.connections.map((connection) => (
                  <article
                    key={connection.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold">{connection.clientName}</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {connection.scope}・Owner Profile
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          最終利用:{" "}
                          {connection.lastUsedAt
                            ? new Date(connection.lastUsedAt).toLocaleString("ja-JP")
                            : "未利用"}
                        </p>
                      </div>
                      {connection.status === "active" && (
                        <button
                          type="button"
                          disabled={revokingId !== null}
                          onClick={() => void revoke(connection.id)}
                          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-300 px-3 text-sm font-bold text-rose-700 disabled:opacity-60 dark:text-rose-300"
                        >
                          <Unplug className="size-4" />
                          {revokingId === connection.id ? "解除中..." : "解除"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <section className="mt-8">
              <h2 className="text-base font-bold">取得履歴</h2>
              <p className="mt-1 text-xs text-slate-500">90日を目安にbest effortで表示します。</p>
              <div className="mt-3 space-y-2">
                {state.data.records.length === 0 && (
                  <p className="text-sm text-slate-500">履歴はありません。</p>
                )}
                {state.data.records.map((record) => (
                  <article
                    key={record.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    <div className="flex justify-between gap-3">
                      <strong>{record.clientName}</strong>
                      <time className="text-xs text-slate-500">
                        {new Date(record.occurredAt).toLocaleString("ja-JP")}
                      </time>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {record.outcome}・{record.reasonCode}・{record.resultCount}件
                    </p>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </dialog>
  );
}
