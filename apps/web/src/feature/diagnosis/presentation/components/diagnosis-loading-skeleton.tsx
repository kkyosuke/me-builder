import { SkeletonBlock, SkeletonLoader } from "../../../../components/skeleton";

function DiagnosisCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-950/10 dark:border-slate-700 dark:bg-slate-800">
      <SkeletonBlock className="aspect-video w-full rounded-none" />
      <div className="p-3">
        <SkeletonBlock className="h-4 w-4/5 rounded-full" />
        <SkeletonBlock className="mt-3 h-3 w-full rounded-full" />
        <SkeletonBlock className="mt-2 h-3 w-3/5 rounded-full" />
        <div className="mt-4 flex justify-end">
          <SkeletonBlock className="size-7 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function DiagnosisListSkeleton() {
  return (
    <SkeletonLoader label="診断一覧を読み込み中">
      <SkeletonBlock className="mb-3 h-5 w-28 rounded-full" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {["first", "second", "third", "fourth"].map((key) => (
          <DiagnosisCardSkeleton key={key} />
        ))}
      </div>
    </SkeletonLoader>
  );
}

export function DiagnosisAnswerSkeleton() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-5 sm:px-8 sm:py-8">
      <SkeletonLoader label="診断回答を読み込み中">
        <SkeletonBlock className="mb-5 h-9 w-28 rounded-xl" />
        <SkeletonBlock className="mb-4 h-14 w-full rounded-2xl" />
        <div className="flex items-center justify-between gap-4">
          <SkeletonBlock className="h-6 w-2/3 rounded-full" />
          <SkeletonBlock className="h-4 w-12 rounded-full" />
        </div>
        <SkeletonBlock className="mt-4 h-1.5 w-full rounded-full" />
        <SkeletonBlock className="mt-4 h-10 w-3/4 rounded-xl" />
        <div className="mt-4 flex h-80 flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-950/10 dark:border-slate-700 dark:bg-slate-800">
          <div className="space-y-3 pt-14">
            <SkeletonBlock className="h-6 w-full rounded-full" />
            <SkeletonBlock className="h-6 w-4/5 rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <SkeletonBlock className="h-12 rounded-2xl" />
            <SkeletonBlock className="h-12 rounded-2xl" />
          </div>
        </div>
        <SkeletonBlock className="mt-7 h-11 w-full rounded-2xl" />
        <div className="mt-3 flex flex-col items-center gap-2">
          <SkeletonBlock className="h-3 w-4/5 rounded-full" />
          <SkeletonBlock className="h-3 w-3/5 rounded-full" />
        </div>
      </SkeletonLoader>
    </main>
  );
}

function DiagnosisParameterSkeleton() {
  return (
    <div className="py-3.5">
      <div className="flex items-center justify-between gap-4">
        <SkeletonBlock className="h-4 w-28 rounded-full" />
        <SkeletonBlock className="h-3 w-20 rounded-full" />
      </div>
      <SkeletonBlock className="mt-3 h-2 w-full rounded-full" />
      <div className="mt-2 flex justify-between gap-4">
        <SkeletonBlock className="h-3 w-20 rounded-full" />
        <SkeletonBlock className="h-3 w-20 rounded-full" />
      </div>
    </div>
  );
}

export function DiagnosisResultSkeleton() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-5 sm:px-8 sm:py-8">
      <SkeletonLoader label="診断結果を読み込み中">
        <SkeletonBlock className="mb-5 h-9 w-28 rounded-xl" />
        <div className="rounded-3xl border border-sky-300/20 bg-white p-5 shadow-xl shadow-slate-950/10 dark:bg-slate-800 sm:p-6">
          <div className="flex items-center gap-3">
            <SkeletonBlock className="size-11 shrink-0 rounded-2xl" />
            <div className="flex-1">
              <SkeletonBlock className="h-3 w-20 rounded-full" />
              <SkeletonBlock className="mt-3 h-5 w-3/4 rounded-full" />
            </div>
          </div>
          <SkeletonBlock className="mt-5 h-3 w-full rounded-full" />
          <SkeletonBlock className="mt-2 h-3 w-4/5 rounded-full" />
          <SkeletonBlock className="mt-4 h-3 w-24 rounded-full" />
        </div>
        <div className="mt-5 flex items-center gap-2">
          <SkeletonBlock className="size-5 rounded-full" />
          <SkeletonBlock className="h-5 w-40 rounded-full" />
        </div>
        <div className="mt-3 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-4 dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
          {["first", "second", "third"].map((key) => (
            <DiagnosisParameterSkeleton key={key} />
          ))}
        </div>
        <SkeletonBlock className="mt-7 h-14 w-full rounded-2xl" />
        <SkeletonBlock className="mt-5 h-12 w-full rounded-xl" />
      </SkeletonLoader>
    </main>
  );
}
