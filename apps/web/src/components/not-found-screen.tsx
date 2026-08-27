export function NotFoundScreen() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-12">
      <p className="text-sm font-bold text-violet-700 dark:text-violet-300">404</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-slate-50">
        ページが見つかりません
      </h1>
      <p className="mt-3 leading-relaxed text-slate-600 dark:text-slate-300">
        URLが正しいか確認するか、診断画面へ戻ってください。
      </p>
      <a
        href="/diagnosis"
        className="mt-6 inline-flex min-h-11 w-fit items-center justify-center rounded-xl bg-violet-600 px-5 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
      >
        診断画面へ戻る
      </a>
    </main>
  );
}
