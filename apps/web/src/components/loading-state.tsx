import { LoaderCircle } from "lucide-react";

export function LoadingState({
  message,
  variant = "page",
}: {
  message: string;
  variant?: "page" | "panel";
}) {
  const className =
    variant === "page"
      ? "mx-auto flex min-h-dvh w-full max-w-2xl items-start justify-center gap-2 px-4 py-8 text-center text-sm text-slate-400 sm:px-8"
      : "col-span-full flex items-center justify-center gap-2 rounded-3xl border border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-400";

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
