import {
  AlertCircle,
  ArrowRight,
  Clock3,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  Send,
} from "lucide-react";
import { MainNavigation } from "../../../components/main-navigation";
import { SkeletonBlock, SkeletonLoader } from "../../../components/skeleton";
import type { AsyncState } from "../../../model/async-state";
import {
  diagnosisCategoryHref,
  getRelationshipCategoryBadgeClassName,
  getRelationshipCategoryLabel,
} from "../../diagnosis/model/relationship-category";
import type {
  CompatibilityRelationshipList,
  CompatibilityRelationshipListItem,
} from "../model/compatibility-relationship";

type PendingItem = Extract<CompatibilityRelationshipListItem, { status: "pending" }>;
type AcceptedItem = Extract<CompatibilityRelationshipListItem, { status: "accepted" }>;
type ReadyItem = AcceptedItem & {
  readiness: Extract<AcceptedItem["readiness"], { status: "ready" }>;
};
type WaitingItem = AcceptedItem & {
  readiness: Extract<AcceptedItem["readiness"], { status: "waiting" }>;
};

function waitingGuide(item: WaitingItem): {
  message: string;
  href: string | null;
  label: string | null;
} {
  if (item.readiness.nextAction === "diagnosis") {
    return {
      message: "この関係で比べられる診断に答えると、相性シートへ自動で反映されます。",
      href: diagnosisCategoryHref(item.relationshipCategory),
      label: "診断を行う",
    };
  }
  if (item.readiness.nextAction === "profile-summary") {
    return {
      message: "「わたしのまとめ」を作ると、あなたの「私について」が共有されます。",
      href: "/me",
      label: "わたしのまとめを作る",
    };
  }
  return {
    message: "あなたの共有内容はそろっています。相手の準備が終わると自動で表示されます。",
    href: null,
    label: null,
  };
}

function ListSkeleton() {
  return (
    <SkeletonLoader label="相性一覧を読み込み中" className="mt-8">
      <div className="space-y-3">
        <SkeletonBlock className="h-36 rounded-3xl" />
        <SkeletonBlock className="h-32 rounded-3xl" />
      </div>
    </SkeletonLoader>
  );
}

export function CompatibilityListScreen({
  state,
  operation = { status: "idle" },
  cancellingRelationshipId = null,
  sharingMessage,
  onRetry,
  onCancel,
  onResend,
}: {
  state: AsyncState<CompatibilityRelationshipList>;
  operation?: AsyncState<string>;
  cancellingRelationshipId?: string | null;
  sharingMessage?: string | null;
  onRetry: () => void;
  onCancel: (relationshipId: string) => void;
  onResend: (item: PendingItem) => void;
}) {
  const accepted =
    state.status === "success" ? state.data.items.filter((x) => x.status === "accepted") : [];
  const ready = accepted.filter((item): item is ReadyItem => item.readiness.status === "ready");
  const waiting = accepted.filter(
    (item): item is WaitingItem => item.readiness.status === "waiting",
  );
  const pending =
    state.status === "success" ? state.data.items.filter((x) => x.status === "pending") : [];

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 pb-28 sm:px-8">
      <header>
        <p className="text-sm font-semibold tracking-wider text-rose-700 dark:text-rose-300">
          2人を知る
        </p>
        <h1
          tabIndex={-1}
          data-main-route-heading="compatibility"
          className="mt-2 text-3xl font-bold text-slate-950 focus:outline-none dark:text-slate-50"
        >
          ふたりの見取り図
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          2人の共通点や違いを、これからの会話のきっかけにします。
        </p>
        <a
          href="/compatibility/share"
          className="mt-6 flex min-h-12 items-center justify-between rounded-2xl bg-rose-400 px-5 py-3 font-bold text-rose-950 shadow-lg shadow-rose-500/20"
        >
          <span className="flex items-center gap-2">
            <Send className="size-5" aria-hidden="true" />
            うつしをシェア
          </span>
          <ArrowRight className="size-5" aria-hidden="true" />
        </a>
      </header>

      {state.status === "loading" && <ListSkeleton />}
      {state.status === "error" && (
        <section className="mt-8 rounded-3xl border border-red-300 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950/30">
          <AlertCircle className="mx-auto size-8 text-red-600" aria-hidden="true" />
          <h2 className="mt-3 font-bold text-red-900 dark:text-red-100">
            相性一覧を表示できませんでした
          </h2>
          <p className="mt-2 text-sm text-red-800 dark:text-red-200">{state.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-200 px-4 font-bold text-red-950"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            再試行
          </button>
        </section>
      )}

      {state.status === "success" && (
        <>
          {state.data.items.length === 0 && (
            <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-800">
              <h2 className="font-bold text-slate-950 dark:text-slate-50">
                まだ共有中の相手はいません
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                うつしをLINEで送って、2人の相性シートを作ってみましょう。
              </p>
            </section>
          )}

          {ready.length > 0 && (
            <section aria-labelledby="available-heading" className="mt-9">
              <h2
                id="available-heading"
                className="text-lg font-bold text-slate-950 dark:text-slate-50"
              >
                結果を見られる相手
              </h2>
              <div className="mt-3 space-y-3">
                {ready.map((item) => (
                  <article
                    key={item.relationshipId}
                    className="rounded-3xl border border-rose-200 bg-white p-5 shadow-lg shadow-slate-950/5 dark:border-rose-900/50 dark:bg-slate-800"
                  >
                    <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      結果あり
                    </p>
                    <p
                      className={`mt-2 w-fit rounded-full px-2.5 py-1 text-xs font-bold ${getRelationshipCategoryBadgeClassName(item.relationshipCategory)}`}
                    >
                      {getRelationshipCategoryLabel(item.relationshipCategory)}
                    </p>
                    <h3 className="mt-1 text-lg font-bold text-slate-950 dark:text-slate-50">
                      {item.partnerDisplayName}さん
                    </h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      {item.readiness.comparableThemeCount}つのテーマで比較できます
                    </p>
                    <a
                      href={`/compatibility/relationships/${item.relationshipId}`}
                      className="mt-4 flex min-h-11 items-center justify-between rounded-xl bg-slate-950 px-4 text-sm font-bold text-white dark:bg-slate-50 dark:text-slate-950"
                    >
                      2人の相性シートを見る
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </a>
                  </article>
                ))}
              </div>
            </section>
          )}

          {waiting.length > 0 && (
            <section aria-labelledby="waiting-heading" className="mt-9">
              <h2
                id="waiting-heading"
                className="text-lg font-bold text-slate-950 dark:text-slate-50"
              >
                準備中
              </h2>
              <div className="mt-3 space-y-3">
                {waiting.map((item) => {
                  const guide = waitingGuide(item);
                  return (
                    <article
                      key={item.relationshipId}
                      className="rounded-3xl border border-amber-200 bg-white p-5 shadow-lg shadow-slate-950/5 dark:border-amber-900/50 dark:bg-slate-800"
                    >
                      <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                        {item.readiness.nextAction ? "あなたの準備待ち" : "相手の準備待ち"}
                      </p>
                      <p
                        className={`mt-2 w-fit rounded-full px-2.5 py-1 text-xs font-bold ${getRelationshipCategoryBadgeClassName(item.relationshipCategory)}`}
                      >
                        {getRelationshipCategoryLabel(item.relationshipCategory)}
                      </p>
                      <h3 className="mt-1 text-lg font-bold text-slate-950 dark:text-slate-50">
                        {item.partnerDisplayName}さん
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                        {guide.message}
                      </p>
                      {guide.href && guide.label && (
                        <a
                          href={guide.href}
                          className="mt-4 flex min-h-11 items-center justify-between rounded-xl bg-amber-400 px-4 text-sm font-bold text-amber-950"
                        >
                          {guide.label}
                          <ArrowRight className="size-4" aria-hidden="true" />
                        </a>
                      )}
                      <a
                        href={`/compatibility/relationships/${item.relationshipId}`}
                        className={`${guide.href ? "mt-2" : "mt-4"} flex min-h-11 items-center justify-between rounded-xl border border-amber-300 px-4 text-sm font-bold text-amber-900 dark:border-amber-700 dark:text-amber-200`}
                      >
                        共有の確認・終了
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </a>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {pending.length > 0 && (
            <section aria-labelledby="pending-heading" className="mt-9">
              <h2
                id="pending-heading"
                className="text-lg font-bold text-slate-950 dark:text-slate-50"
              >
                返事待ち
              </h2>
              <div className="mt-3 space-y-3">
                {pending.map((item) => {
                  const isCancelling = cancellingRelationshipId === item.relationshipId;
                  return (
                    <article
                      key={item.relationshipId}
                      aria-busy={isCancelling}
                      className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-700">
                          <Clock3 className="size-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-bold text-slate-950 dark:text-slate-50">
                            招待リンク
                          </h3>
                          <p
                            className={`mt-2 w-fit rounded-full px-2.5 py-1 text-xs font-bold ${getRelationshipCategoryBadgeClassName(item.relationshipCategory)}`}
                          >
                            {getRelationshipCategoryLabel(item.relationshipCategory)}
                          </p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                            期限: {new Date(item.expiresAt).toLocaleDateString("ja-JP")}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-4">
                            <button
                              type="button"
                              disabled={isCancelling}
                              onClick={() => onResend(item)}
                              className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-[#078d3e] disabled:opacity-50"
                            >
                              <RotateCw className="size-4" aria-hidden="true" />
                              LINEでもう一度送る
                            </button>
                            <button
                              type="button"
                              disabled={operation.status === "loading"}
                              onClick={() => onCancel(item.relationshipId)}
                              className="min-h-10 text-sm font-bold text-red-700 disabled:opacity-50"
                            >
                              取り消す
                            </button>
                          </div>
                        </div>
                      </div>
                      {isCancelling && (
                        <output
                          aria-label="招待を取り消しています"
                          className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-white/90 text-sm font-bold text-slate-700 backdrop-blur-[1px] dark:bg-slate-800/90 dark:text-slate-200"
                        >
                          <LoaderCircle
                            className="size-5 animate-spin motion-reduce:animate-none"
                            aria-hidden="true"
                          />
                          取り消しています...
                        </output>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {(sharingMessage || operation.status === "success" || operation.status === "error") && (
        <p
          aria-live="polite"
          className="mt-4 rounded-2xl bg-sky-400/10 px-4 py-3 text-sm font-semibold text-sky-800 dark:text-sky-200"
        >
          {sharingMessage ??
            (operation.status === "success"
              ? operation.data
              : operation.status === "error"
                ? operation.message
                : "")}
        </p>
      )}
      <MainNavigation current="compatibility" />
    </main>
  );
}
