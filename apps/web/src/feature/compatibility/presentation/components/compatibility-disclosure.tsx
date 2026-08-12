import { LockKeyhole, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

function CompatibilityPrivacyItems() {
  return (
    <ul className="space-y-2 text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
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
  );
}

export function CompatibilityPrivacyNotice({
  footer,
  status,
  title,
}: {
  footer: ReactNode;
  status?: ReactNode;
  title: string;
}) {
  return (
    <section className="mt-8 rounded-3xl border border-emerald-300/40 bg-emerald-50 p-5 dark:border-emerald-700/40 dark:bg-emerald-950/30">
      <h2 className="flex items-center gap-2 font-bold text-emerald-950 dark:text-emerald-100">
        <ShieldCheck className="size-5" aria-hidden="true" />
        {title}
      </h2>
      <div className="mt-3">
        <CompatibilityPrivacyItems />
      </div>
      <p className="mt-4 flex items-start gap-2 border-t border-emerald-300/40 pt-4 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
        <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {footer}
      </p>
      {status && <div className="mt-4 border-t border-emerald-300/40 pt-4">{status}</div>}
    </section>
  );
}
