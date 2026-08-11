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

export function DiagnosisDetailSkeleton() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-5 sm:px-8 sm:py-8">
      <SkeletonLoader label="診断詳細を読み込み中">
        <SkeletonBlock className="mb-5 h-9 w-28 rounded-xl" />
        <SkeletonBlock className="mb-4 h-16 w-full rounded-2xl" />
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-950/10 dark:border-slate-700 dark:bg-slate-800 sm:p-6">
          <div className="flex items-center gap-3">
            <SkeletonBlock className="size-11 shrink-0 rounded-2xl" />
            <div className="flex-1">
              <SkeletonBlock className="h-3 w-20 rounded-full" />
              <SkeletonBlock className="mt-3 h-5 w-3/4 rounded-full" />
            </div>
          </div>
          <SkeletonBlock className="mt-5 h-3 w-full rounded-full" />
          <SkeletonBlock className="mt-2 h-3 w-4/5 rounded-full" />
          <SkeletonBlock className="mt-6 h-2 w-full rounded-full" />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <SkeletonBlock className="h-12 rounded-2xl" />
          <SkeletonBlock className="h-12 rounded-2xl" />
        </div>
      </SkeletonLoader>
    </main>
  );
}
