import { Sparkles } from "lucide-react";
import type {
  CompatibilitySharePreviewParameter,
  CompatibilitySharePreviewTheme,
  CompatibilityShareProfile,
} from "../../model/compatibility-share-preview";

function ShareParameterCard({ parameter }: { parameter: CompatibilitySharePreviewParameter }) {
  return (
    <article className="rounded-2xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-700 dark:bg-rose-950/30">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-2 block size-2 shrink-0 rounded-full bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.12)]"
        />
        <div className="min-w-0 flex-1">
          <h4 className="font-bold text-slate-950 dark:text-slate-50">{parameter.label}</h4>
          <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {parameter.statement}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 to-rose-400"
              style={{ width: `${parameter.position}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between gap-3 text-[0.6875rem] text-slate-500">
            <span>{parameter.lowLabel}</span>
            <span className="text-right">{parameter.highLabel}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export function CompatibilityAboutMePreview({
  eyebrow,
  headingId,
  note,
  profile,
}: {
  eyebrow: string;
  headingId: string;
  note?: string;
  profile: CompatibilityShareProfile;
}) {
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <p className="text-xs font-bold text-slate-500">{eyebrow}</p>
      <h2
        id={headingId}
        className="mt-1 flex items-center gap-2 text-xl font-bold text-slate-950 dark:text-slate-50"
      >
        <Sparkles className="size-5 text-violet-500" aria-hidden="true" />
        まず知ってほしいこと
      </h2>
      <div className="mt-4 space-y-3">
        {profile.statements.map((item) => (
          <article
            key={item.key}
            className="rounded-2xl border border-violet-300 bg-violet-50 p-4 dark:border-violet-700 dark:bg-violet-950/30"
          >
            <h3 className="text-sm font-bold text-violet-950 dark:text-violet-100">{item.label}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {item.statement}
            </p>
          </article>
        ))}
      </div>
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
    </section>
  );
}

export function CompatibilityThemesPreview({
  countLabel,
  eyebrow,
  headingId,
  themes,
}: {
  countLabel?: string;
  eyebrow: string;
  headingId: string;
  themes: CompatibilitySharePreviewTheme[];
}) {
  const parameterCount = themes.reduce((count, theme) => count + theme.parameters.length, 0);
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-slate-500">{eyebrow}</p>
          <h2 id={headingId} className="mt-1 text-xl font-bold text-slate-950 dark:text-slate-50">
            共有する振る舞い・考え方
          </h2>
        </div>
        <span className="text-right text-sm font-bold text-rose-700 dark:text-rose-300">
          {countLabel ?? `${parameterCount}件すべて共有`}
        </span>
      </div>
      <div className="mt-4 space-y-6">
        {themes.map((theme, index) => {
          const themeHeadingId = `${headingId}-theme-${index}`;
          return (
            <section key={theme.diagnosisId} aria-labelledby={themeHeadingId}>
              <h3
                id={themeHeadingId}
                className="mb-3 text-sm font-bold text-slate-700 dark:text-slate-300"
              >
                {theme.title}
              </h3>
              <div className="space-y-3">
                {theme.parameters.map((parameter) => (
                  <ShareParameterCard
                    key={`${theme.diagnosisId}:${parameter.id}`}
                    parameter={parameter}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
