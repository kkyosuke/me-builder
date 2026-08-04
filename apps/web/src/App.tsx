import { ArrowLeft, ArrowRight, ClipboardList } from "lucide-react";
import { useEffect, useState } from "react";
import { SwipeSurvey } from "./components/swipe-survey";
import { config } from "./config";
import { getLiffIdToken, initializeLiff } from "./liff";
import { type SurveyListItem, fetchSurveyList } from "./survey/list";
import { type SurveyDefinition, fetchSurveyDefinitions } from "./survey/questions";

const STATUS_LABELS: Record<SurveyListItem["responseStatus"], string> = {
  unanswered: "未回答",
  "in-progress": "回答途中",
  answered: "回答済み",
};

function Home({
  surveys,
  loadError,
  onOpenSurvey,
}: {
  surveys: SurveyListItem[] | null;
  loadError: string | null;
  onOpenSurvey: (surveyId: string) => void;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 sm:px-8">
      <header className="mb-8">
        <p className="text-sm font-semibold tracking-wider text-sky-300">me-builder</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-50">アンケート</h1>
        <p className="mt-2 text-sm text-slate-400">答えたいカードを選んでください。</p>
      </header>

      <section aria-label="アンケート一覧" className="grid grid-cols-2 gap-3 sm:gap-4">
        {loadError && (
          <p className="col-span-2 rounded-3xl border border-red-400/30 bg-red-400/10 p-6 text-center text-sm text-red-300">
            {`アンケートを読み込めませんでした: ${loadError}`}
          </p>
        )}
        {!loadError && surveys === null && (
          <p className="col-span-2 rounded-3xl border border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-400">
            アンケートを読み込んでいます...
          </p>
        )}
        {!loadError && surveys?.length === 0 && (
          <p className="col-span-2 rounded-3xl border border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-400">
            回答できるアンケートはありません。
          </p>
        )}
        {surveys?.map((survey) => (
          <button
            key={survey.id}
            type="button"
            onClick={() => onOpenSurvey(survey.id)}
            className="group flex min-h-64 flex-col rounded-3xl border border-slate-700 bg-slate-800 p-4 text-left shadow-xl shadow-slate-950/20 transition hover:-translate-y-1 hover:border-sky-400/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 sm:p-5"
          >
            <span className="flex size-11 items-center justify-center rounded-2xl bg-sky-400/10 text-sky-300">
              <ClipboardList className="size-5" aria-hidden="true" />
            </span>
            <span className="mt-5 text-lg leading-snug font-bold text-slate-50">
              {survey.title}
            </span>
            <span className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-400 sm:text-sm">
              {survey.description}
            </span>
            <span className="mt-auto flex items-end justify-between gap-2 pt-5">
              <span>
                <span className="block text-xs text-slate-500">
                  {survey.responseStatus === "in-progress"
                    ? `${survey.answeredCount} / ${survey.questionCount}問`
                    : `${survey.questionCount}問`}
                </span>
                <span className="mt-1 inline-flex rounded-full bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-300">
                  {survey.availability === "closed"
                    ? "受付終了"
                    : STATUS_LABELS[survey.responseStatus]}
                </span>
              </span>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-400 text-slate-900 transition group-hover:translate-x-0.5">
                <ArrowRight className="size-4" aria-hidden="true" />
              </span>
            </span>
          </button>
        ))}
      </section>
    </main>
  );
}

function SurveyDetail({ survey, onBack }: { survey: SurveyDefinition; onBack: () => void }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-5 sm:px-8 sm:py-8">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        アンケート一覧
      </button>

      <SwipeSurvey survey={survey} onBack={onBack} />
    </main>
  );
}

export function App() {
  const [surveys, setSurveys] = useState<SurveyListItem[] | null>(null);
  const [surveyDefinitions, setSurveyDefinitions] = useState<SurveyDefinition[]>([]);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSurveys(): Promise<void> {
      try {
        const liffState = await initializeLiff(config.liffId);
        if (liffState.status !== "ready") {
          if (liffState.status === "login-required") {
            return;
          }
          throw new Error(
            liffState.status === "error"
              ? liffState.message
              : "LINEからアンケート画面を開いてください。",
          );
        }

        const idToken = getLiffIdToken();
        if (!idToken) {
          throw new Error("IDトークンを取得できませんでした。LINEから開き直してください。");
        }

        const [loadedSurveys, definitions] = await Promise.all([
          fetchSurveyList(config.apiUrl, idToken),
          fetchSurveyDefinitions(),
        ]);
        if (!cancelled) {
          setSurveys(loadedSurveys);
          setSurveyDefinitions(definitions);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void loadSurveys();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSurvey = surveyDefinitions.find(({ id }) => id === selectedSurveyId);

  return selectedSurvey ? (
    <SurveyDetail survey={selectedSurvey} onBack={() => setSelectedSurveyId(null)} />
  ) : (
    <Home surveys={surveys} loadError={loadError} onOpenSurvey={setSelectedSurveyId} />
  );
}
