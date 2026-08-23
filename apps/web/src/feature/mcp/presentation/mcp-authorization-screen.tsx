import { useEffect, useState } from "react";
import type { AsyncState } from "../../../model/async-state";
import {
  type McpAuthorizationRequest,
  decideMcpAuthorizationRequest,
  fetchMcpAuthorizationRequest,
} from "../infrastructure/mcp-api";

export function McpAuthorizationScreen() {
  const requestId = new URLSearchParams(window.location.search).get("request") ?? "";
  const [state, setState] = useState<AsyncState<McpAuthorizationRequest>>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetchMcpAuthorizationRequest(requestId, controller.signal)
      .then((data) => setState({ status: "success", data }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "接続要求を取得できませんでした。",
          });
        }
      });
    return () => controller.abort();
  }, [requestId]);

  const decide = async (allow: boolean) => {
    setSubmitting(true);
    try {
      const result = await decideMcpAuthorizationRequest(requestId, allow);
      window.location.assign(result.redirectUrl);
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "接続要求を確定できませんでした。",
      });
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-12 text-slate-950 dark:text-white">
      <h1 className="text-2xl font-bold">MCP接続を確認</h1>
      {state.status === "loading" && <p className="mt-6">接続要求を確認しています...</p>}
      {state.status === "error" && (
        <p role="alert" className="mt-6 text-rose-700 dark:text-rose-300">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h2 className="text-xl font-bold">{state.data.clientName}</h2>
          <p className="mt-2 break-all text-xs text-slate-500">{state.data.clientId}</p>
          <ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>読み取り専用の「search_my_brain」で、自分のBrainを検索します。</li>
            <li>
              外部提供を許可したBrain Itemだけを取得し、Source
              Recordや画像・音声などの原本は取得できません。
            </li>
            <li>取得後にclientが保存した情報は、この接続を解除しても削除されません。</li>
            <li>access tokenは1時間、refresh tokenは最終利用から30日で失効します。</li>
          </ul>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void decide(false)}
              className="min-h-12 rounded-xl border border-slate-300 font-bold disabled:opacity-60 dark:border-slate-600"
            >
              拒否する
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void decide(true)}
              className="min-h-12 rounded-xl bg-sky-700 font-bold text-white disabled:opacity-60"
            >
              接続を許可
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
