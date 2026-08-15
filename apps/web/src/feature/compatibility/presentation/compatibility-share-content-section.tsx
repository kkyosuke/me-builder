import {
  type CompatibilityRelationshipCategory,
  compatibilityRelationshipCategoryValues,
} from "@me-builder/lib/compatibility";
import { BookOpenText, HeartHandshake, RefreshCw, ShieldCheck } from "lucide-react";
import type { AsyncState } from "../../../model/async-state";
import {
  diagnosisCategoryHref,
  getRelationshipCategoryFilterClassName,
  getRelationshipCategoryLabel,
} from "../../diagnosis/model/relationship-category";
import type { CompatibilityShareContent } from "../model/compatibility-share-content";
import { useCompatibilityShareContent } from "./hooks/use-compatibility-share-content";

function ShareContentSkeleton() {
  return (
    <output aria-busy="true" aria-label="共有される内容を読み込み中" className="mt-5 space-y-4">
      <div
        aria-hidden="true"
        className="h-28 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-700"
      />
      <div
        aria-hidden="true"
        className="h-40 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-700"
      />
    </output>
  );
}

function AboutMe({ content }: { content: CompatibilityShareContent }) {
  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-800 dark:bg-sky-950/30">
      <h3 className="flex items-center gap-2 font-bold text-slate-950 dark:text-slate-50">
        <BookOpenText className="size-5 text-sky-600 dark:text-sky-300" aria-hidden="true" />
        私について
      </h3>
      {content.aboutMe ? (
        <dl className="mt-3 space-y-3">
          {content.aboutMe.statements.map(({ key, label, statement }) => (
            <div key={key} className="rounded-xl bg-white/80 p-3 dark:bg-slate-900/60">
              <dt className="text-xs font-bold text-sky-700 dark:text-sky-300">{label}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                「{statement}」
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="mt-3 rounded-xl bg-white/80 p-4 dark:bg-slate-900/60">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
            共有できる「私について」はまだありません
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            上の「わたしのまとめ」を作ると、相手向けの文章も用意されます。
          </p>
        </div>
      )}
    </section>
  );
}

function Themes({ content }: { content: CompatibilityShareContent }) {
  if (content.themes.length === 0) {
    return (
      <section className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-800 dark:bg-violet-950/30">
        <h3 className="flex items-center gap-2 font-bold text-slate-950 dark:text-slate-50">
          <HeartHandshake
            className="size-5 text-violet-600 dark:text-violet-300"
            aria-hidden="true"
          />
          診断から見える傾向
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          このカテゴリで共有できる診断テーマはまだありません。
        </p>
        <a
          href={diagnosisCategoryHref(content.relationshipCategory)}
          className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
        >
          {getRelationshipCategoryLabel(content.relationshipCategory)}の診断を見る
        </a>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-800 dark:bg-violet-950/30">
      <h3 className="flex items-center gap-2 font-bold text-slate-950 dark:text-slate-50">
        <HeartHandshake
          className="size-5 text-violet-600 dark:text-violet-300"
          aria-hidden="true"
        />
        診断から見える傾向
      </h3>
      <div className="mt-3 space-y-4">
        {content.themes.map((theme) => (
          <article
            key={theme.diagnosisId}
            className="rounded-xl bg-white/80 p-4 dark:bg-slate-900/60"
          >
            <h4 className="font-bold text-slate-950 dark:text-slate-50">{theme.title}</h4>
            <div className="mt-3 space-y-4">
              {theme.parameters.map((parameter) => (
                <div key={parameter.id}>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    {parameter.label}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    {parameter.statement}
                  </p>
                  <span className="relative mt-3 block h-2 rounded-full bg-slate-200 dark:bg-slate-700">
                    <span
                      className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-violet-500 shadow dark:border-slate-900"
                      style={{ left: `${parameter.position}%` }}
                      aria-hidden="true"
                    />
                  </span>
                  <div className="mt-2 flex justify-between gap-3 text-2xs text-slate-500 dark:text-slate-400">
                    <span>{parameter.lowLabel}</span>
                    <span className="text-right">{parameter.highLabel}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CompatibilityShareContentSectionScreen({
  relationshipCategory,
  state,
  onRelationshipCategoryChange,
  onRetry,
}: {
  relationshipCategory: CompatibilityRelationshipCategory;
  state: AsyncState<CompatibilityShareContent>;
  onRelationshipCategoryChange: (category: CompatibilityRelationshipCategory) => void;
  onRetry: () => void;
}) {
  return (
    <section
      aria-labelledby="compatibility-share-content-heading"
      className="mt-10 border-t border-slate-200 pt-8 dark:border-slate-700"
    >
      <p className="text-xs font-bold tracking-wider text-violet-700 dark:text-violet-300">
        共有前に確認
      </p>
      <h2
        id="compatibility-share-content-heading"
        className="mt-1 text-xl font-bold text-slate-950 dark:text-slate-50"
      >
        うつしで共有される内容
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        招待が承諾され、2人の共有が始まったあと、選んだ関係に応じて次の内容が共有されます。
      </p>

      <fieldset className="-mx-4 mt-5 flex min-w-0 gap-2 overflow-x-auto border-0 px-4 pt-0 pb-1 sm:mx-0 sm:px-0">
        <legend className="sr-only">共有内容を確認する関係カテゴリ</legend>
        {compatibilityRelationshipCategoryValues.map((category) => (
          <button
            type="button"
            key={category}
            aria-pressed={relationshipCategory === category}
            onClick={() => onRelationshipCategoryChange(category)}
            className={`shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-rose-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 ${getRelationshipCategoryFilterClassName(category)}`}
          >
            {getRelationshipCategoryLabel(category)}
          </button>
        ))}
      </fieldset>

      {state.status === "loading" && <ShareContentSkeleton />}
      {state.status === "error" && (
        <div className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
          <p className="font-bold text-red-900 dark:text-red-100">
            共有される内容を表示できませんでした
          </p>
          <p className="mt-1 text-sm text-red-800 dark:text-red-200">{state.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-200 px-4 text-sm font-bold text-red-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            再試行
          </button>
        </div>
      )}
      {state.status === "success" && (
        <div className="mt-5 space-y-4">
          <AboutMe content={state.data} />
          <Themes content={state.data} />
          <p className="flex items-start gap-2 rounded-2xl bg-slate-100 p-4 text-xs leading-relaxed text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300"
              aria-hidden="true"
            />
            生の回答、日記や会話、具体的な出来事、内容を作った根拠は共有されません。
          </p>
        </div>
      )}
    </section>
  );
}

export function CompatibilityShareContentSection({
  acquireIdToken,
  latestProfileSummaryVersionId,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
  latestProfileSummaryVersionId: string | null | undefined;
}) {
  const content = useCompatibilityShareContent({
    acquireIdToken,
    latestProfileSummaryVersionId,
  });
  return (
    <CompatibilityShareContentSectionScreen
      relationshipCategory={content.relationshipCategory}
      state={content.state}
      onRelationshipCategoryChange={content.changeRelationshipCategory}
      onRetry={() => void content.reload()}
    />
  );
}
