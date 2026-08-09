import { ArrowRight, CheckCircle2, HeartHandshake, ShieldCheck, UserCheck } from "lucide-react";
import { useState } from "react";
import type { CompatibilityPerson } from "../model/compatibility";
import {
  CompatibilityAvatar,
  CompatibilityBackHeader,
  DemoNotice,
  ThemeSelectionCard,
} from "./compatibility-ui";

export function CompatibilityInvitationScreen({
  inviter,
  recipient,
}: {
  inviter: CompatibilityPerson;
  recipient: CompatibilityPerson;
}) {
  const [selectedThemeIds, setSelectedThemeIds] = useState(() =>
    recipient.themes.map((theme) => theme.id),
  );
  const [accepted, setAccepted] = useState(false);

  if (accepted) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-8">
        <section className="rounded-3xl border border-emerald-300/40 bg-gradient-to-br from-emerald-50 to-sky-50 p-7 text-center shadow-xl shadow-slate-950/10 dark:border-emerald-700/40 dark:from-emerald-950/30 dark:to-sky-950/30">
          <span className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-emerald-400/20 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-8" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-bold text-slate-950 dark:text-slate-50">
            あおいさんとの相性シートを作りました
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            選んだテーマの範囲で、2人の共通点や違いを見てみましょう。
          </p>
          <a
            href="/compatibility/demo"
            className="mt-6 flex min-h-12 items-center justify-between rounded-2xl bg-rose-400 px-5 py-3 font-bold text-rose-950"
          >
            2人の相性シートを見る
            <ArrowRight className="size-5" aria-hidden="true" />
          </a>
        </section>
        <DemoNotice />
      </main>
    );
  }

  const selectedCount = selectedThemeIds.length;
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6 pb-12 sm:px-8">
      <CompatibilityBackHeader href="/compatibility" label="閉じる" />
      <section className="mt-5 rounded-3xl border border-violet-300/30 bg-gradient-to-br from-violet-50 via-white to-rose-50 p-5 text-center dark:from-violet-950/30 dark:via-slate-800 dark:to-rose-950/30">
        <div className="flex items-center justify-center gap-3">
          <CompatibilityAvatar person={inviter} size="lg" />
          <HeartHandshake className="size-7 text-rose-500" aria-hidden="true" />
          <span className="flex size-20 items-center justify-center rounded-[55%_45%_40%_60%] border-2 border-dashed border-slate-300 text-sm font-bold text-slate-500 dark:border-slate-600">
            あなた
          </span>
        </div>
        <p className="mt-5 text-sm font-semibold text-violet-700 dark:text-violet-300">
          あおいさんから招待が届いています
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-50">
          2人の相性を見てみませんか？
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          診断から見える範囲で、お互いの大切にしたいことを資料にまとめます。
        </p>
      </section>

      <section aria-labelledby="recipient-preview-heading" className="mt-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
              <UserCheck className="size-4" aria-hidden="true" />
              あおいさんに見える内容
            </p>
            <h2
              id="recipient-preview-heading"
              className="mt-1 text-xl font-bold text-slate-950 dark:text-slate-50"
            >
              私について
            </h2>
          </div>
          <span className="text-sm font-bold text-rose-700 dark:text-rose-300">
            {selectedCount}件を共有
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          共有したくないテーマは外せます。あおいさんも同じように内容を確認済みです。
        </p>
        <div className="mt-4 space-y-3">
          {recipient.themes.map((theme) => (
            <ThemeSelectionCard
              key={theme.id}
              theme={theme}
              selected={selectedThemeIds.includes(theme.id)}
              onChange={(selected) =>
                setSelectedThemeIds((current) =>
                  selected
                    ? [...current, theme.id]
                    : current.filter((themeId) => themeId !== theme.id),
                )
              }
            />
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-3xl border border-emerald-300/40 bg-emerald-50 p-5 dark:border-emerald-700/40 dark:bg-emerald-950/30">
        <h2 className="flex items-center gap-2 font-bold text-emerald-950 dark:text-emerald-100">
          <ShieldCheck className="size-5" aria-hidden="true" />
          承諾する前に
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
          生の回答、日記、自由記述は共有されません。承諾すると双方の相性一覧へ追加され、共有はどちらからでも終了できます。
        </p>
      </section>

      <button
        type="button"
        disabled={selectedCount === 0}
        onClick={() => setAccepted(true)}
        className="mt-8 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-400 px-5 py-3 font-bold text-rose-950 shadow-lg shadow-rose-500/20 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none dark:disabled:bg-slate-700"
      >
        <HeartHandshake className="size-5" aria-hidden="true" />
        相性を見てみる
      </button>
      {selectedCount === 0 && (
        <p className="mt-3 text-center text-sm font-semibold text-red-700 dark:text-red-300">
          共有するテーマを1つ以上選んでください。
        </p>
      )}
      <a
        href="/compatibility"
        className="mt-3 flex min-h-11 items-center justify-center text-sm font-bold text-slate-500"
      >
        今は承諾しない
      </a>
      <DemoNotice />
    </main>
  );
}
