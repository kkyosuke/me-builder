import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw, Search, Users } from "lucide-react";
import { SkeletonBlock, SkeletonLoader } from "../../../components/skeleton";
import type { AsyncState } from "../../../model/async-state";
import type { AdminAccount, AdminAccountFilters, AdminAccountPage } from "../model/account";

const number = new Intl.NumberFormat("ja-JP");
const date = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" });
const dateTime = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function ProgressionValues({ account }: { account: AdminAccount }) {
  if (account.progression.status === "pending") {
    return <span className="text-sm text-amber-700 dark:text-amber-300">レベル集計中</span>;
  }
  return (
    <div>
      <p className="font-semibold tabular-nums">Lv.{number.format(account.progression.level)}</p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        計算版 v{account.progression.calculationVersion}
      </p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        集計更新 {dateTime.format(new Date(account.progression.projectedAt))}
      </p>
    </div>
  );
}

function LastGrowth({ account }: { account: AdminAccount }) {
  if (account.progression.status === "pending") return <span>—</span>;
  if (!account.progression.lastGrowthAt) return <span>まだ成長記録がありません</span>;
  return <span>{dateTime.format(new Date(account.progression.lastGrowthAt))}</span>;
}

function AccountCards({ accounts }: { accounts: readonly AdminAccount[] }) {
  return (
    <ul className="grid gap-3 lg:hidden">
      {accounts.map((account) => (
        <li
          key={account.id}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-bold text-slate-950 dark:text-slate-50">
                {account.displayName ?? "名前未取得"}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400">
                {account.id}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <span className="rounded-full bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                {account.role}
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                {account.status}
              </span>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3 text-sm dark:bg-slate-900">
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">うつしレベル</dt>
              <dd className="mt-1">
                <ProgressionValues account={account} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">わたしのかけら</dt>
              <dd className="mt-1 tabular-nums">
                {account.progression.status === "ready"
                  ? `集めた ${number.format(account.progression.collectedPieces)}・有効 ${number.format(account.progression.activePieces)}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">登録日</dt>
              <dd className="mt-1">{date.format(new Date(account.createdAt))}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">最終成長</dt>
              <dd className="mt-1 text-xs">
                <LastGrowth account={account} />
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function AccountTable({ accounts }: { accounts: readonly AdminAccount[] }) {
  return (
    <section
      aria-label="Account一覧。横にスクロールできます"
      className="hidden max-w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white lg:block dark:border-slate-700 dark:bg-slate-800"
    >
      <table className="w-full min-w-5xl text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              名前 / Account ID
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              role / status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              うつしレベル
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              かけら
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              登録日
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              最終成長
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className="border-t border-slate-200 dark:border-slate-700">
              <th scope="row" className="max-w-64 px-4 py-3 font-medium">
                <span className="block truncate">{account.displayName ?? "名前未取得"}</span>
                <span className="mt-1 block break-all font-mono text-xs font-normal text-slate-500 dark:text-slate-400">
                  {account.id}
                </span>
              </th>
              <td className="px-4 py-3">
                <span className="font-medium">{account.role}</span>
                <span className="mx-1 text-slate-400">/</span>
                <span>{account.status}</span>
              </td>
              <td className="px-4 py-3">
                <ProgressionValues account={account} />
              </td>
              <td className="px-4 py-3 tabular-nums">
                {account.progression.status === "ready" ? (
                  <>
                    <span className="block">
                      集めた {number.format(account.progression.collectedPieces)}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                      有効 {number.format(account.progression.activePieces)}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {date.format(new Date(account.createdAt))}
              </td>
              <td className="px-4 py-3 text-xs whitespace-nowrap">
                <LastGrowth account={account} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AccountsSkeleton() {
  return (
    <SkeletonLoader label="Account一覧を読み込み中">
      <section className="mt-6" aria-label="アカウント">
        <div className="mt-6">
          <SkeletonBlock className="h-6 w-28 rounded-full" />
          <SkeletonBlock className="mt-2 h-4 w-32 rounded-full" />
        </div>
        <div className="mt-4 grid gap-3 rounded-2xl bg-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,1fr)_9rem_9rem_12rem] dark:bg-slate-800/70">
          {["search", "role", "status", "sort"].map((key) => (
            <SkeletonBlock key={key} className="h-10 rounded-xl" />
          ))}
        </div>
        <div className="mt-4 grid gap-3 lg:hidden">
          {["first", "second"].map((key) => (
            <SkeletonBlock key={key} className="h-44 rounded-2xl" />
          ))}
        </div>
        <SkeletonBlock className="mt-4 hidden h-64 w-full rounded-2xl lg:block" />
      </section>
    </SkeletonLoader>
  );
}

export function AdminAccountsScreen({
  state,
  filters,
  isRefreshing = false,
  pageNumber = 1,
  canGoBack = false,
  onReload,
  onFilterChange,
  onNextPage,
  onPreviousPage,
}: {
  state: AsyncState<AdminAccountPage>;
  filters: AdminAccountFilters;
  isRefreshing?: boolean;
  pageNumber?: number;
  canGoBack?: boolean;
  onReload: () => void;
  onFilterChange: <TKey extends keyof AdminAccountFilters>(
    key: TKey,
    value: AdminAccountFilters[TKey],
  ) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
}) {
  if (state.status === "idle" || state.status === "loading") return <AccountsSkeleton />;
  if (state.status === "error") {
    return (
      <section className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <AlertCircle className="size-10 text-rose-500" aria-hidden="true" />
        <p>{state.message}</p>
        <button
          type="button"
          onClick={onReload}
          className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-slate-900"
        >
          再読み込み
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="accounts-heading" className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="accounts-heading" className="flex items-center gap-2 text-xl font-bold">
            <Users className="size-5 text-violet-500" aria-hidden="true" />
            Account
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            該当 {number.format(state.data.total)} Account
          </p>
        </div>
        <button
          type="button"
          onClick={onReload}
          disabled={isRefreshing}
          aria-label={isRefreshing ? "Account一覧を更新中" : undefined}
          className="flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
        >
          <RefreshCw
            className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {isRefreshing ? "更新中..." : "更新"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 rounded-2xl bg-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,1fr)_9rem_9rem_12rem] dark:bg-slate-800/70">
        <label className="relative">
          <span className="sr-only">名前・Account IDを検索</span>
          <Search
            className="pointer-events-none absolute top-3 left-3 size-4 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={filters.query}
            onChange={(event) => onFilterChange("query", event.currentTarget.value)}
            placeholder="名前・Account IDを検索"
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-3 pl-9 text-sm dark:border-slate-600 dark:bg-slate-900"
          />
        </label>
        <label>
          <span className="sr-only">statusで絞り込み</span>
          <select
            value={filters.status}
            onChange={(event) =>
              onFilterChange("status", event.currentTarget.value as AdminAccountFilters["status"])
            }
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="all">すべてのstatus</option>
            <option value="active">active</option>
          </select>
        </label>
        <label>
          <span className="sr-only">roleで絞り込み</span>
          <select
            value={filters.role}
            onChange={(event) =>
              onFilterChange("role", event.currentTarget.value as AdminAccountFilters["role"])
            }
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="all">すべてのrole</option>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label>
          <span className="sr-only">並べ替え</span>
          <select
            value={filters.sort}
            onChange={(event) =>
              onFilterChange("sort", event.currentTarget.value as AdminAccountFilters["sort"])
            }
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="created">登録日が新しい順</option>
            <option value="level">レベルが高い順</option>
            <option value="pieces">かけらが多い順</option>
            <option value="growth">最終成長が新しい順</option>
          </select>
        </label>
      </div>

      <div className="mt-4">
        {state.data.accounts.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
            <p className="font-semibold">条件に一致するAccountはありません</p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              検索条件を変えてください。
            </p>
          </div>
        ) : (
          <>
            <AccountCards accounts={state.data.accounts} />
            <AccountTable accounts={state.data.accounts} />
          </>
        )}
      </div>

      <nav aria-label="Account一覧のページ" className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={!canGoBack || isRefreshing}
          onClick={onPreviousPage}
          className="rounded-full border border-slate-300 p-2 disabled:opacity-40 dark:border-slate-600"
          aria-label="前のページ"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <span className="px-2 text-sm tabular-nums">{number.format(pageNumber)}</span>
        <button
          type="button"
          disabled={!state.data.nextCursor || isRefreshing}
          onClick={onNextPage}
          className="rounded-full border border-slate-300 p-2 disabled:opacity-40 dark:border-slate-600"
          aria-label="次のページ"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </nav>
    </section>
  );
}
