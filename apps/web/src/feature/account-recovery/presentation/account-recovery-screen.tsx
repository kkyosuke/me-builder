import { type FormEvent, useState } from "react";
import { config } from "../../../config";
import { useLiffSession } from "../../liff";
import { completeRecovery } from "../infrastructure/account-recovery-api";

export function AccountRecoveryScreen() {
  const liffSession = useLiffSession();
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "recovered">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState("submitting");
    setError(null);
    try {
      const idToken = await liffSession.acquireIdToken(new AbortController().signal);
      if (!idToken) throw new Error("LINEから復旧画面を開き直してください。");
      await completeRecovery(config.apiUrl, idToken, code.trim());
      setState("recovered");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Accountを復旧できませんでした。");
      setState("idle");
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-12">
      <p className="text-sm font-bold text-sky-700 dark:text-sky-300">ACCOUNT RECOVERY</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">有料契約を復旧</h1>
      {state === "recovered" ? (
        <div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-100">
          <p className="font-bold">同じAccountへ接続しました</p>
          <p className="mt-2 text-sm">
            LINEからかがみを開き直すと、契約と保存済みデータを引き続き利用できます。
          </p>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="mt-6">
          <label htmlFor="account-recovery-code" className="block text-sm font-bold">
            復旧コード
          </label>
          <input
            id="account-recovery-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            required
            className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-mono text-sm dark:border-slate-600 dark:bg-slate-800"
          />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            StripeのメールアドレスやCustomer
            IDだけでは復旧できません。事前に保存した一回限りのコードを入力してください。
          </p>
          {error && (
            <p role="alert" className="mt-4 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={state === "submitting" || code.trim().length === 0}
            className="mt-6 min-h-12 w-full rounded-xl bg-sky-600 px-5 font-bold text-white disabled:opacity-60"
          >
            {state === "submitting" ? "確認しています..." : "このLINE Accountへ接続"}
          </button>
        </form>
      )}
      <a
        href="/contact"
        className="mt-8 text-center text-sm font-bold text-sky-700 underline dark:text-sky-300"
      >
        復旧コードがない場合の解約・問い合わせ
      </a>
    </main>
  );
}
