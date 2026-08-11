import { ChevronDown, Code2, Database, RefreshCw, ScanSearch } from "lucide-react";
import { SkeletonBlock, SkeletonLoader } from "../../../components/skeleton";
import type { AsyncState } from "../../../model/async-state";
import type {
  DevelopmentBrainItemsResult,
  DevelopmentBrainVectorResult,
} from "../model/brain-item";

const categoryLabels: Record<string, string> = {
  memory: "Memory",
  preference: "Preference",
  boundary: "Boundary",
  need: "Need",
  goal: "Goal",
  strategy: "Strategy",
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function vectorStatusLabel(sync: DevelopmentBrainItemsResult["items"][number]["vectorSync"]) {
  switch (sync.status) {
    case "not-scheduled":
      return "Vector未登録";
    case "pending":
      return sync.hasEntry ? "Vector更新待ち" : "Vector登録待ち";
    case "submitted":
      return sync.hasEntry ? "Vector更新送信中" : "Vector送信中";
    case "applied":
      return sync.hasEntry ? "Vector同期受付済み" : "Vector未登録";
    case "failed":
      return "Vector再試行中";
  }
}

function VectorVerification({
  state,
}: {
  state: AsyncState<DevelopmentBrainVectorResult> | undefined;
}) {
  if (!state || state.status === "idle") return null;
  if (state.status === "loading") {
    return <p className="mt-2 text-xs text-slate-500">Vectorizeを照合しています...</p>;
  }
  if (state.status === "error") {
    return <p className="mt-2 text-xs text-red-700 dark:text-red-300">{state.message}</p>;
  }
  if (state.data.state === "not-synced") {
    return <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">対応表に未登録です。</p>;
  }
  if (state.data.state === "missing") {
    return (
      <p className="mt-2 text-xs text-red-700 dark:text-red-300">
        Vectorizeに実体がありません。非同期反映待ち、または同期不整合の可能性があります。
      </p>
    );
  }
  const metadata = [
    state.data.metadata.category,
    state.data.metadata.derivation,
    state.data.metadata.embeddingVersion
      ? `embedding v${state.data.metadata.embeddingVersion}`
      : undefined,
    state.data.metadata.schemaVersion ? `schema v${state.data.metadata.schemaVersion}` : undefined,
  ].filter(Boolean);
  return (
    <div className="mt-2 rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-200">
      <p className="font-semibold">{`Vectorizeに実体あり（${state.data.dimensions}次元）`}</p>
      {metadata.length > 0 && <p className="mt-1">{metadata.join(" / ")}</p>}
      <p className="mt-1 text-slate-500">{`確認: ${formatDateTime(state.data.checkedAt)}`}</p>
    </div>
  );
}

export function DevelopmentBrainItems({
  state,
  vectorStates,
  onRetry,
  onVerifyVector,
}: {
  state: AsyncState<DevelopmentBrainItemsResult>;
  vectorStates: Record<string, AsyncState<DevelopmentBrainVectorResult>>;
  onRetry: () => void;
  onVerifyVector: (brainItemId: string) => void;
}) {
  return (
    <section
      aria-labelledby="development-brain-items-heading"
      className="mt-8 rounded-3xl border border-dashed border-violet-400/50 bg-violet-50/70 p-5 dark:bg-violet-950/20"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-700 dark:text-violet-300">
          <Code2 className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">
            Development
          </p>
          <h2
            id="development-brain-items-heading"
            className="mt-1 text-lg font-bold text-slate-950 dark:text-slate-50"
          >
            Brain Item一覧
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            保存済みのactive Itemだけを表示しています。本番環境には表示されません。
          </p>
        </div>
      </div>

      {state.status === "loading" && (
        <SkeletonLoader label="Brain Item一覧を読み込み中" className="mt-5">
          <div className="space-y-3">
            {["first", "second"].map((key) => (
              <div
                key={key}
                className="rounded-2xl border border-violet-200 bg-white p-4 dark:border-violet-800 dark:bg-slate-900/70"
              >
                <div className="flex gap-2">
                  <SkeletonBlock className="h-6 w-20 rounded-full" />
                  <SkeletonBlock className="h-6 w-16 rounded-full" />
                </div>
                <SkeletonBlock className="mt-4 h-4 w-4/5 rounded-full" />
                <SkeletonBlock className="mt-2 h-4 w-3/5 rounded-full" />
                <SkeletonBlock className="mt-4 h-3 w-28 rounded-full" />
              </div>
            ))}
          </div>
        </SkeletonLoader>
      )}

      {state.status === "error" && (
        <div className="mt-5 rounded-2xl bg-red-400/10 p-4 text-sm text-red-700 dark:text-red-300">
          <p>{state.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-red-300 px-3 py-2 font-semibold text-slate-950"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            再試行
          </button>
        </div>
      )}

      {state.status === "success" && state.data.items.length === 0 && (
        <div className="mt-5 rounded-2xl border border-violet-200 bg-white/80 p-5 text-center dark:border-violet-800 dark:bg-slate-900/60">
          <Database className="mx-auto size-6 text-violet-500" aria-hidden="true" />
          <p className="mt-3 font-semibold text-slate-900 dark:text-slate-100">
            追加されたBrain Itemはありません
          </p>
          <p className="mt-1 text-xs text-slate-500">
            LINEで話したあと、10分後の変換が完了するとここに表示されます。
          </p>
        </div>
      )}

      {state.status === "success" && state.data.items.length > 0 && (
        <>
          <ol className="mt-5 space-y-3">
            {state.data.items.map((item) => (
              <li
                key={item.id}
                className="rounded-2xl border border-violet-200 bg-white p-4 dark:border-violet-800 dark:bg-slate-900/70"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-violet-500/15 px-2 py-1 font-bold text-violet-800 dark:text-violet-200">
                    {categoryLabels[item.category] ?? item.category}
                  </span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-800 dark:text-emerald-200">
                    active
                  </span>
                  <span className="text-slate-500">
                    {item.derivation === "ai" ? "AI変換" : "決定的な変換"}
                  </span>
                  <span
                    className={
                      item.vectorSync.status === "failed"
                        ? "rounded-full bg-red-500/15 px-2 py-1 font-semibold text-red-800 dark:text-red-200"
                        : "rounded-full bg-sky-500/15 px-2 py-1 font-semibold text-sky-800 dark:text-sky-200"
                    }
                  >
                    {vectorStatusLabel(item.vectorSync)}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-slate-950 dark:text-slate-50">
                  {item.statement}
                </p>
                <p className="mt-2 text-xs text-slate-500">{formatDateTime(item.createdAt)}</p>

                <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-slate-500">
                      <p>{`同期試行 ${item.vectorSync.attemptCount}回`}</p>
                      {item.vectorSync.failureCode && (
                        <p className="mt-1 text-red-700 dark:text-red-300">
                          {`error: ${item.vectorSync.failureCode}`}
                        </p>
                      )}
                      {item.vectorSync.nextAttemptAt && (
                        <p className="mt-1">{`次回: ${formatDateTime(item.vectorSync.nextAttemptAt)}`}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onVerifyVector(item.id)}
                      disabled={vectorStates[item.id]?.status === "loading"}
                      className="inline-flex items-center gap-2 rounded-xl bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-900 disabled:cursor-wait disabled:opacity-60 dark:bg-sky-900/40 dark:text-sky-100"
                    >
                      <ScanSearch className="size-4" aria-hidden="true" />
                      Vectorizeで実体確認
                    </button>
                  </div>
                  <VectorVerification state={vectorStates[item.id]} />
                </div>

                <details className="group mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-slate-300">
                    <span>{`Evidence ${item.evidence.length}件`}</span>
                    <ChevronDown
                      className="size-4 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <ul className="mt-3 space-y-2">
                    {item.evidence.map((edge) => (
                      <li
                        key={`${edge.sourceRecordId}:${edge.relation}`}
                        className="rounded-xl bg-slate-100 p-3 text-xs dark:bg-slate-800"
                      >
                        <p className="break-all font-mono text-slate-700 dark:text-slate-300">
                          {edge.sourceRecordId}
                        </p>
                        <p className="mt-1 text-slate-500">
                          {`${edge.relation} / ${edge.derivationMethod}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ol>
          {state.data.truncated && (
            <p className="mt-4 text-xs text-amber-700 dark:text-amber-300">
              最新100件を表示しています。
            </p>
          )}
        </>
      )}
    </section>
  );
}
