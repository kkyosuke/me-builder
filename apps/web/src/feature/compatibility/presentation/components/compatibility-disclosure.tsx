import { ChevronDown, LockKeyhole, ShieldCheck } from "lucide-react";
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
      <div className="mt-3">
        <CompatibilityPrivacyItems />
      </div>
      <p className="mt-4 flex items-start gap-2 border-t border-emerald-300/40 pt-4 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
        <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {footer}
      </p>
    </section>
  );
}

/** 固定フッター向けに、共有されない情報を初期状態で折りたたんで表示する。 */
export function CompatibilityPrivacyDisclosure({ footer }: { footer: ReactNode }) {
  return (
    <details className="group rounded-xl bg-emerald-50 dark:bg-emerald-950/40">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 text-sm font-bold text-emerald-950 [&::-webkit-details-marker]:hidden dark:text-emerald-100">
        <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">共有されない詳細</span>
        <ChevronDown
          className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-emerald-300/40 px-3 pt-3 pb-3">
        <CompatibilityPrivacyItems />
        <p className="mt-3 flex items-start gap-2 border-t border-emerald-300/40 pt-3 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {footer}
        </p>
      </div>
    </details>
  );
}
