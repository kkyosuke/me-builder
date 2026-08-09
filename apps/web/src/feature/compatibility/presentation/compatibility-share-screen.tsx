import { CheckCircle2, Copy, ExternalLink, Send } from "lucide-react";
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
import { useShareInvitation } from "./hooks/use-share-invitation";

export function CompatibilityShareScreen({
  copyInvitation,
  invitationUrl,
  lineShareUrl,
  person,
}: {
  copyInvitation: (url: string) => Promise<void>;
  invitationUrl: string;
  lineShareUrl: string;
  person: CompatibilityPerson;
}) {
  const share = useShareInvitation({ invitationUrl, copyInvitation });

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

      <CompatibilityDisclosurePreview
        eyebrow="相手に見える「私について」"
        headingId="themes-heading"
        themes={person.themes}
      />

      <CompatibilityPrivacyNotice
        title="共有されない詳細"
        footer="相手が内容を確認して承諾するまで、共有は始まりません。共有は後から終了できます。"
      />

      {share.state === "editing" ? (
        <button
          type="button"
          onClick={share.issue}
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
            {invitationUrl}
          </p>
          <a
            href={lineShareUrl}
            className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#06c755] px-4 py-3 font-bold text-white"
          >
            LINEで送る
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={() => void share.copy()}
            className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-sky-300 bg-white px-4 py-3 font-bold text-sky-900 dark:border-sky-700 dark:bg-slate-900 dark:text-sky-100"
          >
            {share.state === "copied" ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {share.state === "copied"
              ? "コピーしました"
              : share.state === "copy-failed"
                ? "コピーできませんでした"
                : "リンクをコピー"}
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
