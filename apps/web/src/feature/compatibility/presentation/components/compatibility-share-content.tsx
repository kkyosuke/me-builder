import { HeartHandshake, RefreshCcw, Users } from "lucide-react";

const sharedItems = [
  {
    key: "about-me",
    icon: Users,
    title: "うつしから作った「私について」",
    description: "大切にしたいことや心地よい選び方を、一人称の文章として相手へ見せます。",
  },
  {
    key: "themes",
    icon: HeartHandshake,
    title: "診断から見える傾向",
    description: "2人とも回答した診断テーマだけを、傾向の位置として並べて比べます。",
  },
  {
    key: "updates",
    icon: RefreshCcw,
    title: "これから増える分も自動で",
    description:
      "共有を始めたあとに答えた診断や、新しく作られたまとめも、確認なしでこの相手へ共有されます。",
  },
] as const;

/** 具体的な文章や傾向の値ではなく、共有される情報の種類だけを示す。 */
export function CompatibilityShareScope({ headingId }: { headingId: string }) {
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId} className="text-xl font-bold text-slate-950 dark:text-slate-50">
        共有されるもの
      </h2>
      <ul className="mt-4 space-y-3">
        {sharedItems.map(({ description, icon: Icon, key, title }) => (
          <li
            key={key}
            className="flex gap-3 rounded-2xl border border-violet-300 bg-violet-50 p-4 dark:border-violet-700 dark:bg-violet-950/30"
          >
            <Icon
              className="mt-0.5 size-5 shrink-0 text-violet-600 dark:text-violet-300"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h3 className="font-bold text-violet-950 dark:text-violet-100">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {description}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
