import { LoaderCircle } from "lucide-react";

export function LoadingState({
  message,
  variant = "page",
}: {
  message: string;
  variant?: "page" | "panel" | "overlay";
}) {
  const className =
    variant === "page"
      ? "mx-auto flex min-h-dvh w-full max-w-2xl items-center justify-center gap-2 px-4 py-8 text-center text-sm text-slate-600 dark:text-slate-400 sm:px-8"
      : variant === "overlay"
        ? "fixed inset-0 z-[80] flex min-h-dvh items-center justify-center gap-2 bg-slate-50 px-4 text-center text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400"
        : "col-span-full flex items-center justify-center gap-2 rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 text-center text-sm text-slate-600 dark:text-slate-400";

  return (
    <output aria-live="polite" className={className}>
      <LoaderCircle
        className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      {message}
    </output>
  );
}
