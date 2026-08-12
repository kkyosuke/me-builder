import { LockKeyhole, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { CompatibilityTheme } from "../../model/compatibility";
import { ThemePreviewCard } from "./compatibility-ui";

export function CompatibilityDisclosurePreview({
  description,
  eyebrow,
  headingId,
  themes,
}: {
  description?: string;
  eyebrow: ReactNode;
  headingId: string;
  themes: CompatibilityTheme[];
}) {
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-slate-500">{eyebrow}</p>
          <h2 id={headingId} className="mt-1 text-xl font-bold text-slate-950 dark:text-slate-50">
            共有する振る舞い・考え方
          </h2>
        </div>
        <span className="text-sm font-bold text-rose-700 dark:text-rose-300">
          {themes.length}件すべて共有
        </span>
      </div>
      {description && (
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {description}
        </p>
      )}
      <div className="mt-4 space-y-3">
        {themes.map((theme) => (
          <ThemePreviewCard key={theme.id} theme={theme} />
        ))}
      </div>
    </section>
  );
}

export function CompatibilityPrivacyNotice({
  footer,
  title,
}: {
  footer: ReactNode;
  title: string;
}) {
  return (
    <section className="mt-8 rounded-3xl border border-emerald-300/40 bg-emerald-50 p-5 dark:border-emerald-700/40 dark:bg-emerald-950/30">
      <h2 className="flex items-center gap-2 font-bold text-emerald-950 dark:text-emerald-100">
        <ShieldCheck className="size-5" aria-hidden="true" />
        {title}
      </h2>
      <ul className="mt-3 space-y-2 text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
        <li className="flex gap-2">
          <span aria-hidden="true">・</span>診断で選んだ具体的な回答
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true">・</span>日記やLINEの会話本文、具体的な出来事や記憶
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true">・</span>自由記述や会話そのものの内容
        </li>
      </ul>
      <p className="mt-4 flex items-start gap-2 border-t border-emerald-300/40 pt-4 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
        <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {footer}
      </p>
    </section>
  );
}
