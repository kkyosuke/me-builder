import { ArrowLeft } from "lucide-react";
import type { CompatibilityPerson, CompatibilityTheme } from "../model/compatibility";

export function CompatibilityAvatar({
  person,
  size = "md",
}: {
  person: CompatibilityPerson;
  size?: "md" | "lg";
}) {
  const color =
    person.color === "sky"
      ? "from-sky-300 to-cyan-500 text-sky-950"
      : "from-violet-300 to-fuchsia-500 text-violet-950";
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-[40%_60%_55%_45%] bg-gradient-to-br font-black shadow-lg ${color} ${
        size === "lg" ? "size-20 text-2xl" : "size-12 text-lg"
      }`}
    >
      {person.initial}
    </span>
  );
}

export function CompatibilityBackHeader({
  href = "/compatibility",
  label = "相性一覧",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <header>
      <a
        href={href}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-bold text-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 dark:text-sky-200"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        {label}
      </a>
    </header>
  );
}

export function DemoNotice() {
  return (
    <p className="mt-6 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
      この画面は体験確認用のサンプルです。表示内容や操作はまだ保存されません。
    </p>
  );
}

export function ThemePreviewCard({ theme }: { theme: CompatibilityTheme }) {
  return (
    <article className="rounded-2xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-700 dark:bg-rose-950/30">
      <span className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-2 block size-2 shrink-0 rounded-full bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.12)]"
        />
        <span className="min-w-0">
          <span className="block font-bold text-slate-950 dark:text-slate-50">{theme.title}</span>
          <span className="mt-1 block text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            「{theme.statement}」
          </span>
          <span className="mt-3 block text-xs font-semibold text-slate-500">{theme.axis}</span>
          <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-sky-400 to-rose-400"
              style={{ width: `${theme.position}%` }}
            />
          </span>
          <span className="mt-1 flex justify-between gap-3 text-[0.6875rem] text-slate-500">
            <span>{theme.leftLabel}</span>
            <span className="text-right">{theme.rightLabel}</span>
          </span>
        </span>
      </span>
    </article>
  );
}
