import { CheckCircle2, Copy, ExternalLink, LockKeyhole, Send, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { demoInvitationUrl } from "../infrastructure/compatibility-demo";
import type { CompatibilityPerson } from "../model/compatibility";
import {
  CompatibilityAvatar,
  CompatibilityBackHeader,
  DemoNotice,
  ThemePreviewCard,
} from "./compatibility-ui";

type ShareState = "editing" | "issued" | "copied";

export function CompatibilityShareScreen({ person }: { person: CompatibilityPerson }) {
  const [shareState, setShareState] = useState<ShareState>("editing");

  const copyLink = async () => {
    await navigator.clipboard?.writeText(demoInvitationUrl).catch(() => undefined);
    setShareState("copied");
  };

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6 pb-12 sm:px-8">
      <CompatibilityBackHeader />
      <div className="mt-5 flex items-center gap-4">
        <CompatibilityAvatar person={person} size="lg" />
        <div>
          <p className="text-sm font-semibold tracking-wider text-rose-700 dark:text-rose-300">
            あなたから招待
          </p>
          <h1 className="mt-1 text-3xl font-bold text-slate-950 dark:text-slate-50">
            うつしをシェア
          </h1>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        診断から見える振る舞い・考え方の傾向をすべて共有します。相手に見える内容を確認してから、1人用の招待リンクを発行します。
      </p>

      <section aria-labelledby="themes-heading" className="mt-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-slate-500">相手に見える「私について」</p>
            <h2
              id="themes-heading"
              className="mt-1 text-xl font-bold text-slate-950 dark:text-slate-50"
            >
              共有する振る舞い・考え方
            </h2>
          </div>
          <span className="text-sm font-bold text-rose-700 dark:text-rose-300">
            {person.themes.length}件すべて共有
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {person.themes.map((theme) => (
            <ThemePreviewCard key={theme.id} theme={theme} />
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-3xl border border-emerald-300/40 bg-emerald-50 p-5 dark:border-emerald-700/40 dark:bg-emerald-950/30">
        <h2 className="flex items-center gap-2 font-bold text-emerald-950 dark:text-emerald-100">
          <ShieldCheck className="size-5" aria-hidden="true" />
          共有されない詳細
        </h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
          <li className="flex gap-2">
            <span aria-hidden="true">・</span>診断で選んだ具体的な回答
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">・</span>日記やLINEの会話から得た記憶
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">・</span>自由記述や会話そのものの内容
          </li>
        </ul>
        <p className="mt-4 flex items-start gap-2 border-t border-emerald-300/40 pt-4 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          相手が内容を確認して承諾するまで、共有は始まりません。共有は後から終了できます。
        </p>
      </section>

      {shareState === "editing" ? (
        <button
          type="button"
          onClick={() => setShareState("issued")}
          className="mt-8 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-400 px-5 py-3 font-bold text-rose-950 shadow-lg shadow-rose-500/20"
        >
          <Send className="size-5" aria-hidden="true" />
          招待リンクを発行
        </button>
      ) : (
        <section
          aria-live="polite"
          className="mt-8 rounded-3xl border border-sky-300/40 bg-sky-50 p-5 dark:border-sky-700/40 dark:bg-sky-950/30"
        >
          <p className="flex items-center gap-2 font-bold text-sky-950 dark:text-sky-100">
            <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />
            招待リンクを発行しました
          </p>
          <p className="mt-2 break-all rounded-xl bg-white/80 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
            {demoInvitationUrl}
          </p>
          <a
            href={`https://line.me/R/msg/text/?${encodeURIComponent(`相性診断の招待が届いています。承諾するまで共有は始まりません。\n${demoInvitationUrl}`)}`}
            className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#06c755] px-4 py-3 font-bold text-white"
          >
            LINEで送る
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-sky-300 bg-white px-4 py-3 font-bold text-sky-900 dark:border-sky-700 dark:bg-slate-900 dark:text-sky-100"
          >
            {shareState === "copied" ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {shareState === "copied" ? "コピーしました" : "リンクをコピー"}
          </button>
          <a
            href="/compatibility"
            className="mt-4 block min-h-10 text-center text-sm font-bold text-sky-800 underline underline-offset-4 dark:text-sky-200"
          >
            相性一覧へ戻る
          </a>
        </section>
      )}

      <DemoNotice />
    </main>
  );
}
