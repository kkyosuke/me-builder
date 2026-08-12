import { BookOpenText, HeartHandshake, Lightbulb, MessageCircleQuestion } from "lucide-react";
import type { CompatibilityPerson, CompatibilityTheme } from "../../model/compatibility";
import { CompatibilityAvatar } from "./compatibility-ui";

export function CompatibilityPersonSheet({
  isMe,
  person,
}: {
  isMe: boolean;
  person: CompatibilityPerson;
}) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-950/5 dark:border-slate-700 dark:bg-slate-800 sm:p-6">
      <div className="flex items-center gap-3">
        <CompatibilityAvatar person={person} />
        <div>
          <p className="text-xs font-bold text-slate-500">共有プロフィール</p>
          <h2 className="mt-0.5 text-xl font-bold text-slate-950 dark:text-slate-50">
            {isMe ? "わたしについて" : `${person.name}さんについて`}
          </h2>
        </div>
      </div>

      <section className="mt-6">
        <h3 className="flex items-center gap-2 font-bold text-slate-950 dark:text-slate-50">
          <BookOpenText className="size-5 text-sky-600 dark:text-sky-300" aria-hidden="true" />
          まず知ってほしいこと
        </h3>
        <ul className="mt-3 space-y-3">
          {person.statements.slice(0, 3).map((statement) => (
            <li
              key={statement}
              className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-800 dark:bg-slate-900/60 dark:text-slate-200"
            >
              「{statement}」
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-700">
        <h3 className="font-bold text-slate-950 dark:text-slate-50">テーマ別に見る</h3>
        <div className="mt-3 space-y-3">
          {person.themes.map((theme) => (
            <div key={theme.id} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/60">
              <p className="text-sm font-bold text-slate-950 dark:text-slate-50">{theme.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {theme.statement}
              </p>
              <span className="relative mt-3 block h-2 rounded-full bg-slate-200 dark:bg-slate-700">
                <span
                  className={`absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${person.color === "sky" ? "bg-sky-500" : "bg-violet-500"}`}
                  style={{ left: `${theme.position}%` }}
                />
              </span>
              <div className="mt-2 flex justify-between gap-2 text-[0.6875rem] text-slate-500">
                <span>{theme.leftLabel}</span>
                <span className="text-right">{theme.rightLabel}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {person.themes.some((theme) => theme.request) && (
        <section className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-700">
          <h3 className="flex items-center gap-2 font-bold text-slate-950 dark:text-slate-50">
            <HeartHandshake
              className="size-5 text-rose-600 dark:text-rose-300"
              aria-hidden="true"
            />
            こうしてもらえるとうれしい
          </h3>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {person.themes
              .filter((theme) => theme.request)
              .slice(0, 2)
              .map((theme) => (
                <li key={theme.id} className="flex gap-2">
                  <span className="text-rose-500" aria-hidden="true">
                    ●
                  </span>
                  {theme.request}
                </li>
              ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function AxisComparison({
  mePosition,
  partnerName,
  partnerPosition,
  theme,
}: {
  mePosition: number;
  partnerName: string;
  partnerPosition: number;
  theme: CompatibilityTheme;
}) {
  return (
    <div className="mt-4 rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/60">
      <p className="font-bold text-slate-950 dark:text-slate-50">{theme.title}</p>
      <div className="mt-3 space-y-3">
        {[
          { label: "わたし", position: mePosition, color: "bg-sky-500" },
          { label: `${partnerName}さん`, position: partnerPosition, color: "bg-violet-500" },
        ].map((person) => (
          <div key={person.label} className="grid grid-cols-[5rem_1fr] items-center gap-2">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
              {person.label}
            </span>
            <span className="relative block h-2 rounded-full bg-slate-200 dark:bg-slate-700">
              <span
                className={`absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${person.color}`}
                style={{ left: `${person.position}%` }}
              />
            </span>
          </div>
        ))}
      </div>
      <div className="ml-[5.5rem] mt-2 flex justify-between gap-2 text-[0.6875rem] text-slate-500">
        <span>{theme.leftLabel}</span>
        <span className="text-right">{theme.rightLabel}</span>
      </div>
    </div>
  );
}

export function CompatibilityPairSheet({
  me,
  partner,
}: {
  me: CompatibilityPerson;
  partner: CompatibilityPerson;
}) {
  const pairs = me.themes.flatMap((theme) => {
    const partnerTheme = partner.themes.find((candidate) => candidate.id === theme.id);
    return partnerTheme ? [{ theme, partnerTheme }] : [];
  });
  const band = (position: number) => (position < 40 ? "low" : position > 60 ? "high" : "middle");
  const common = pairs.filter(
    ({ theme, partnerTheme }) =>
      band(theme.position) !== "middle" && band(theme.position) === band(partnerTheme.position),
  );
  const different = pairs.filter(
    ({ theme, partnerTheme }) =>
      (band(theme.position) === "low" && band(partnerTheme.position) === "high") ||
      (band(theme.position) === "high" && band(partnerTheme.position) === "low"),
  );

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-emerald-300/40 bg-emerald-50 p-5 dark:border-emerald-700/40 dark:bg-emerald-950/30">
        <h2 className="flex items-center gap-2 text-lg font-bold text-emerald-950 dark:text-emerald-100">
          <Lightbulb className="size-5" aria-hidden="true" />
          一緒に大切にできそうなこと
        </h2>
        {common.length > 0 ? (
          <div className="mt-3 space-y-4">
            {common.map(({ theme, partnerTheme }) => (
              <div key={theme.id}>
                <p className="text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
                  「{theme.title}」では、2人に近い傾向が見えています。
                </p>
                <AxisComparison
                  theme={theme}
                  mePosition={theme.position}
                  partnerName={partner.name}
                  partnerPosition={partnerTheme.position}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
            回答から、断定できる共通点はまだ見つかっていません。
          </p>
        )}
      </section>

      <section className="rounded-3xl border border-amber-300/50 bg-amber-50 p-5 dark:border-amber-700/40 dark:bg-amber-950/30">
        <h2 className="flex items-center gap-2 text-lg font-bold text-amber-950 dark:text-amber-100">
          <MessageCircleQuestion className="size-5" aria-hidden="true" />
          話してみたい違い
        </h2>
        {different.length > 0 ? (
          <div className="mt-3 space-y-4">
            {different.map(({ theme, partnerTheme }) => (
              <div key={theme.id}>
                <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
                  「{theme.title}
                  」では異なる傾向が見えています。どんな場面でそれぞれが心地よいか、話してみるきっかけにできます。
                </p>
                <AxisComparison
                  theme={theme}
                  mePosition={theme.position}
                  partnerName={partner.name}
                  partnerPosition={partnerTheme.position}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-amber-900 dark:text-amber-200">
            大きく異なる傾向は、回答からはまだ見つかっていません。
          </p>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="font-bold text-slate-950 dark:text-slate-50">まだ分からないこと</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          回答が増えると、比較できるテーマも増えていきます。
        </p>
        <a
          href="/diagnosis"
          className="mt-3 inline-flex min-h-10 items-center text-sm font-bold text-sky-700 dark:text-sky-300"
        >
          診断を見てみる
        </a>
      </section>
    </div>
  );
}
