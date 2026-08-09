import { ArrowRight, CheckCircle2, HeartHandshake, UserCheck } from "lucide-react";
import { useState } from "react";
import type { CompatibilityPerson } from "../model/compatibility";
import {
  CompatibilityDisclosurePreview,
  CompatibilityPrivacyNotice,
} from "./components/compatibility-disclosure";
import {
  CompatibilityAvatar,
  CompatibilityBackHeader,
  DemoNotice,
} from "./components/compatibility-ui";

export function CompatibilityInvitationScreen({
  inviter,
  recipient,
}: {
  inviter: CompatibilityPerson;
  recipient: CompatibilityPerson;
}) {
  const [accepted, setAccepted] = useState(false);

  if (accepted) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-8">
        <section className="rounded-3xl border border-emerald-300/40 bg-gradient-to-br from-emerald-50 to-sky-50 p-7 text-center shadow-xl shadow-slate-950/10 dark:border-emerald-700/40 dark:from-emerald-950/30 dark:to-sky-950/30">
          <span className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-emerald-400/20 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-8" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-bold text-slate-950 dark:text-slate-50">
            {inviter.name}さんとの相性シートを作りました
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            共有された振る舞い・考え方から、2人の共通点や違いを見てみましょう。
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
          {inviter.name}さんから招待が届いています
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-50">
          2人の相性を見てみませんか？
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          診断から見える範囲で、お互いの大切にしたいことを資料にまとめます。
        </p>
      </section>

      <CompatibilityDisclosurePreview
        eyebrow={
          <span className="flex items-center gap-1.5">
            <UserCheck className="size-4" aria-hidden="true" />
            {inviter.name}さんに見える内容
          </span>
        }
        headingId="recipient-preview-heading"
        description={`診断から見える傾向をすべて共有します。${inviter.name}さんも同じ範囲を確認済みです。`}
        themes={recipient.themes}
      />

      <CompatibilityPrivacyNotice
        title="承諾する前に"
        footer="承諾すると双方の相性一覧へ追加され、共有はどちらからでも終了できます。"
      />

      <button
        type="button"
        onClick={() => setAccepted(true)}
        className="mt-8 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-400 px-5 py-3 font-bold text-rose-950 shadow-lg shadow-rose-500/20"
      >
        <HeartHandshake className="size-5" aria-hidden="true" />
        相性を見てみる
      </button>
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
