import { ArrowLeft } from "lucide-react";
import type { CompatibilityPerson } from "../../model/compatibility";

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
