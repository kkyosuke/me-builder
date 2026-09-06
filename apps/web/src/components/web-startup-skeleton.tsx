import type { WebApplicationRoute } from "../model/web-application-route";

type StartupCopy = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  layout: "cards" | "rows";
}>;

const SKELETON_IDS = ["first", "second", "third", "fourth"] as const;

function startupCopy(route: WebApplicationRoute): StartupCopy {
  if (route === "me") {
    return {
      eyebrow: "今のわたしを映す",
      title: "わたしのまとめ",
      description: "これまでに見つかったことを準備しています。",
      layout: "rows",
    };
  }
  if (route === "compatibility") {
    return {
      eyebrow: "ふたりを知る",
      title: "相性",
      description: "共有している相手との情報を準備しています。",
      layout: "rows",
    };
  }
  if (route === "profile") {
    return {
      eyebrow: "設定",
      title: "プロフィール",
      description: "プロフィールを準備しています。",
      layout: "rows",
    };
  }
  if (route === "admin") {
    return {
      eyebrow: "管理",
      title: "ダッシュボード",
      description: "管理情報を準備しています。",
      layout: "rows",
    };
  }
  if (route === "mcp-authorization") {
    return {
      eyebrow: "MCP連携",
      title: "接続の確認",
      description: "認可内容を準備しています。",
      layout: "rows",
    };
  }
  if (route === "account-recovery") {
    return {
      eyebrow: "Account復旧",
      title: "本人確認",
      description: "復旧手続きを準備しています。",
      layout: "rows",
    };
  }
  return {
    eyebrow: "私をひもとく",
    title: "わたしの診断",
    description: "答えられる診断を準備しています。",
    layout: "cards",
  };
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="aspect-video bg-slate-200 dark:bg-slate-700" />
      <div className="space-y-3 p-3">
        <div className="h-5 w-16 rounded-full bg-slate-200 dark:bg-slate-700" />
        <div className="h-4 w-4/5 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-700/70" />
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="h-4 w-2/5 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-4 h-3 w-full rounded bg-slate-100 dark:bg-slate-700/70" />
      <div className="mt-2 h-3 w-3/4 rounded bg-slate-100 dark:bg-slate-700/70" />
    </div>
  );
}

/** APIを待たず、要求画面の位置関係を保って最初に表示する静的な骨格。 */
export function WebStartupSkeleton({ route }: { route: WebApplicationRoute }) {
  const copy = startupCopy(route);
  return (
    <main
      aria-busy="true"
      aria-label={`${copy.title}を準備しています`}
      className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 pb-28 sm:px-8"
    >
      <output className="sr-only">{copy.title}を準備しています</output>
      <header className="mb-8 pr-14 sm:pr-0">
        <p className="text-sm font-semibold tracking-wider text-sky-700 dark:text-sky-300">
          {copy.eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-slate-50">{copy.title}</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{copy.description}</p>
      </header>
      <div
        aria-hidden="true"
        className={`animate-pulse motion-reduce:animate-none ${copy.layout === "cards" ? "grid grid-cols-2 gap-3 sm:gap-4" : "space-y-4"}`}
      >
        {SKELETON_IDS.map((id) =>
          copy.layout === "cards" ? <CardSkeleton key={id} /> : <RowSkeleton key={id} />,
        )}
      </div>
    </main>
  );
}
