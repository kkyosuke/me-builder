import { ArrowRight, CheckCircle2, Clock3, RotateCw, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { MainNavigation } from "../../../components/main-navigation";
import type { CompatibilityListData } from "../model/compatibility";
import { CompatibilityAvatar, DemoNotice } from "./components/compatibility-ui";

export function CompatibilityListScreen({ data }: { data: CompatibilityListData }) {
  const [inviteVisible, setInviteVisible] = useState(true);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const { available, diagnosisWaiting, owner } = data;
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 pb-28 sm:px-8">
      <header>
        <p className="text-sm font-semibold tracking-wider text-rose-700 dark:text-rose-300">
          2人を知る
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-slate-50">
          ふたりの見取り図
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          2人の共通点や違いを、これからの会話のきっかけにします。
        </p>
        <a
          href="/compatibility/share"
          className="mt-6 flex min-h-12 items-center justify-between rounded-2xl bg-rose-400 px-5 py-3 font-bold text-rose-950 shadow-lg shadow-rose-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
        >
          <span className="flex items-center gap-2">
            <Send className="size-5" aria-hidden="true" />
            うつしをシェア
          </span>
          <ArrowRight className="size-5" aria-hidden="true" />
        </a>
      </header>

      <section aria-labelledby="available-heading" className="mt-9">
        <div className="flex items-center justify-between">
          <h2
            id="available-heading"
            className="text-lg font-bold text-slate-950 dark:text-slate-50"
          >
            結果を見られる相手
          </h2>
          <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
            1人
          </span>
        </div>
        <article className="mt-3 rounded-3xl border border-rose-200 bg-gradient-to-br from-white to-rose-50 p-5 shadow-lg shadow-slate-950/5 dark:border-rose-900/50 dark:from-slate-800 dark:to-rose-950/30">
          <div className="flex items-center">
            <div className="flex items-center">
              <CompatibilityAvatar person={owner} />
              <span className="-mx-1 text-lg font-bold text-slate-400">×</span>
              <CompatibilityAvatar person={available.partner} />
            </div>
            <div className="ml-4 min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                結果あり
              </div>
              <h3 className="mt-1 truncate text-lg font-bold text-slate-950 dark:text-slate-50">
                {available.partner.name}さん
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {available.comparableThemeCount}つのテーマで比較できます
              </p>
            </div>
          </div>
          <a
            href={available.href}
            className="mt-5 flex min-h-11 items-center justify-between rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white dark:bg-slate-50 dark:text-slate-950"
          >
            2人の相性シートを見る
            <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </article>
      </section>

      <section aria-labelledby="preparing-heading" className="mt-9">
        <h2 id="preparing-heading" className="text-lg font-bold text-slate-950 dark:text-slate-50">
          準備中
        </h2>
        <div className="mt-3 space-y-3">
          <article className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-violet-400/15 text-violet-700 dark:text-violet-300">
                <Sparkles className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-slate-950 dark:text-slate-50">
                    {diagnosisWaiting.name}さん
                  </h3>
                  <span className="rounded-full bg-violet-400/15 px-2 py-1 text-xs font-bold text-violet-700 dark:text-violet-300">
                    診断待ち
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  比較できる内容を、もう一度確認してください。
                </p>
                <a
                  href={diagnosisWaiting.href}
                  className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-bold text-sky-700 dark:text-sky-300"
                >
                  診断を見る
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
              </div>
            </div>
          </article>

          {inviteVisible && (
            <article className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-700 dark:text-amber-300">
                  <Clock3 className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold text-slate-950 dark:text-slate-50">招待リンク</h3>
                    <span className="rounded-full bg-amber-400/15 px-2 py-1 text-xs font-bold text-amber-800 dark:text-amber-300">
                      返事待ち
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    相手が承諾するまで、相手の情報は表示されません。
                  </p>
                  <div className="mt-3 flex gap-4">
                    <button
                      type="button"
                      onClick={() =>
                        setOperationMessage("LINEで送り直せる招待リンクを用意しました。")
                      }
                      className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-sky-700 dark:text-sky-300"
                    >
                      <RotateCw className="size-4" aria-hidden="true" />
                      もう一度送る
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInviteVisible(false);
                        setOperationMessage("招待を取り消しました。");
                      }}
                      className="min-h-10 text-sm font-bold text-slate-500"
                    >
                      取り消す
                    </button>
                  </div>
                </div>
              </div>
            </article>
          )}
        </div>
      </section>

      {operationMessage && (
        <p
          aria-live="polite"
          className="mt-4 rounded-2xl bg-sky-400/10 px-4 py-3 text-sm font-semibold text-sky-800 dark:text-sky-200"
        >
          {operationMessage}
        </p>
      )}

      <DemoNotice />
      <MainNavigation current="compatibility" />
    </main>
  );
}
