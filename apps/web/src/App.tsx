import { ArrowLeft, ArrowRight, ClipboardList, Info, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "./config";
import { getLiffIdToken, initializeLiff } from "./feature/liff";
import {
  type SurveyAnswer,
  type SurveyDefinition,
  type SurveyListItem,
  SwipeSurvey,
  fetchSurveyDefinition,
  fetchSurveyList,
  saveSurveyAnswer,
} from "./feature/survey";
import { OperationError } from "./infrastructure/errors";

const STATUS_LABELS: Record<SurveyListItem["responseStatus"], string> = {
  unanswered: "未回答",
  "in-progress": "回答途中",
  answered: "回答済み",
};

function Home({
  surveys,
  loadError,
  isLoading,
  onOpenSurvey,
  onRetry,
}: {
  surveys: SurveyListItem[] | null;
  loadError: string | null;
  isLoading: boolean;
  onOpenSurvey: (survey: SurveyListItem) => void;
  onRetry: () => void;
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
          <div className="col-span-2 rounded-3xl border border-red-400/30 bg-red-400/10 p-6 text-center text-sm text-red-300">
            <p>{`アンケートを読み込めませんでした: ${loadError}`}</p>
            <button
              type="button"
              onClick={onRetry}
              disabled={isLoading}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-red-300 px-4 py-2 font-semibold text-slate-950 transition hover:bg-red-200 disabled:cursor-wait disabled:opacity-60"
            >
              <RotateCw
                className={`size-4 ${isLoading ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {isLoading ? "再試行しています..." : "再試行"}
            </button>
          </div>
        )}
        {!loadError && isLoading && surveys === null && (
          <p className="col-span-2 rounded-3xl border border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-400">
            アンケートを読み込んでいます...
          </p>
        )}
        {!loadError && !isLoading && surveys?.length === 0 && (
          <p className="col-span-2 rounded-3xl border border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-400">
            回答できるアンケートはありません。
          </p>
        )}
        {surveys?.map((survey) => (
          <button
            key={survey.id}
            type="button"
            onClick={() => onOpenSurvey(survey)}
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

function SurveyDetail({
  survey,
  onBack,
  onSaveAnswer,
}: {
  survey: SurveyDefinition;
  onBack: () => void;
  onSaveAnswer: Parameters<typeof SwipeSurvey>[0]["onSaveAnswer"];
}) {
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

      <p className="mb-4 rounded-2xl border border-sky-300/30 bg-sky-300/10 px-4 py-3 text-sm leading-relaxed text-sky-100">
        回答は1問ずつ保存されます。保存に失敗した場合は、選択を保ったまま再試行できます。
      </p>
      <SwipeSurvey survey={survey} onBack={onBack} onSaveAnswer={onSaveAnswer} />
    </main>
  );
}

type GuidanceKind = "closed" | "answered" | "in-progress" | "unsupported" | "load-error";

const GUIDANCE: Record<GuidanceKind, { title: string; message: string }> = {
  closed: {
    title: "このアンケートは受付を終了しました",
    message: "未回答のため、新しく回答を始めることはできません。アンケート一覧へお戻りください。",
  },
  answered: {
    title: "回答内容画面は現在準備中です",
    message:
      "回答済みのアンケートです。回答内容を表示する機能が未実装のため、この画面から新しい回答は開始しません。",
  },
  "in-progress": {
    title: "回答の再開機能は現在準備中です",
    message:
      "回答途中のアンケートです。続きから再開する機能が未実装のため、第1問から新しい回答を開始しません。",
  },
  unsupported: {
    title: "このアンケートは現在のアプリでは未対応です",
    message:
      "一覧には表示されていますが、回答画面の準備ができていません。対応までしばらくお待ちください。",
  },
  "load-error": {
    title: "アンケートを読み込めませんでした",
    message: "通信状態を確認して、アンケート一覧からもう一度開いてください。",
  },
};

function Guidance({ kind, onBack }: { kind: GuidanceKind; onBack: () => void }) {
  const content = GUIDANCE[kind];
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl items-center px-4 py-8 sm:px-8">
      <section className="w-full rounded-3xl border border-slate-700 bg-slate-800 p-6 text-center shadow-xl shadow-slate-950/20">
        <Info className="mx-auto size-12 text-sky-300" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-bold text-slate-50">{content.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">{content.message}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          アンケート一覧へ
        </button>
      </section>
    </main>
  );
}

function resolveSurveyDestination(survey: SurveyListItem): "answer" | GuidanceKind {
  if (survey.responseStatus === "answered") {
    return "answered";
  }
  if (survey.responseStatus === "in-progress") {
    return "in-progress";
  }
  if (survey.availability === "closed") {
    return "closed";
  }
  return "answer";
}

function applySavedProgress(
  survey: SurveyListItem,
  progress: Pick<SurveyListItem, "responseStatus" | "answeredCount" | "questionCount">,
): SurveyListItem {
  // バックグラウンド保存のレスポンス順が前後しても進捗を巻き戻しません。
  const answeredCount = Math.max(survey.answeredCount, progress.answeredCount);
  const questionCount = progress.questionCount;
  return {
    ...survey,
    responseStatus: answeredCount === questionCount ? "answered" : "in-progress",
    answeredCount,
    questionCount,
  };
}

export function App() {
  const [surveys, setSurveys] = useState<SurveyListItem[] | null>(null);
  const [selectedSurvey, setSelectedSurvey] = useState<SurveyListItem | null>(null);
  const [selectedDefinition, setSelectedDefinition] = useState<SurveyDefinition | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "unsupported" | "error">(
    "idle",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(false);
  const loading = useRef(false);
  const request = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const idToken = useRef<string | null>(null);

  const loadSurveys = useCallback(async (): Promise<void> => {
    if (loading.current) {
      return;
    }
    loading.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (mounted.current) {
      setIsLoading(true);
      setLoadError(null);
    }

    try {
      const liffState = await initializeLiff(config.liffId);
      if (controller.signal.aborted) {
        return;
      }
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

      const currentIdToken = getLiffIdToken();
      if (!currentIdToken) {
        throw new Error("IDトークンを取得できませんでした。LINEから開き直してください。");
      }
      idToken.current = currentIdToken;

      const loadedSurveys = await fetchSurveyList(config.apiUrl, currentIdToken, controller.signal);
      if (mounted.current && !controller.signal.aborted) {
        setSurveys(loadedSurveys);
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (request.current === controller) {
        loading.current = false;
        if (mounted.current && !controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void loadSurveys();
      }
    });
    return () => {
      active = false;
      mounted.current = false;
      request.current?.abort();
      detailRequest.current?.abort();
      loading.current = false;
    };
  }, [loadSurveys]);

  const openSurvey = useCallback(async (survey: SurveyListItem): Promise<void> => {
    setSelectedSurvey(survey);
    setSelectedDefinition(null);
    const destination = resolveSurveyDestination(survey);
    if (destination !== "answer") {
      setDetailState("idle");
      return;
    }

    const currentIdToken = idToken.current;
    if (!currentIdToken) {
      setDetailState("error");
      return;
    }
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setDetailState("loading");
    try {
      const definition = await fetchSurveyDefinition(
        config.apiUrl,
        currentIdToken,
        survey.id,
        controller.signal,
      );
      if (!controller.signal.aborted && mounted.current) {
        setSelectedDefinition(definition ?? null);
        setDetailState(definition ? "idle" : "unsupported");
      }
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) {
        if (error instanceof OperationError && error.code === "SURVEY_UNAVAILABLE") {
          setDetailState("unsupported");
        } else if (error instanceof OperationError && error.code === "SURVEY_CLOSED") {
          setSelectedSurvey({ ...survey, availability: "closed" });
          setDetailState("idle");
        } else {
          setDetailState("error");
        }
      }
    }
  }, []);

  const persistAnswer = useCallback(
    async (answer: SurveyAnswer) => {
      const currentIdToken = idToken.current;
      if (!currentIdToken || !selectedDefinition) {
        throw new Error("本人確認情報を取得できませんでした。LINEから開き直してください。");
      }
      const result = await saveSurveyAnswer(
        config.apiUrl,
        currentIdToken,
        selectedDefinition.id,
        answer.surveyQuestionId,
        answer.choiceId,
      );
      setSurveys(
        (current) =>
          current?.map((survey) =>
            survey.id === selectedDefinition.id
              ? applySavedProgress(survey, result.progress)
              : survey,
          ) ?? null,
      );
      return { acceptedAt: result.answer.acceptedAt };
    },
    [selectedDefinition],
  );

  if (selectedSurvey) {
    const destination = resolveSurveyDestination(selectedSurvey);
    if (destination === "answer" && selectedDefinition) {
      return (
        <SurveyDetail
          survey={selectedDefinition}
          onBack={() => setSelectedSurvey(null)}
          onSaveAnswer={persistAnswer}
        />
      );
    }
    if (destination === "answer" && detailState === "loading") {
      return (
        <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8 text-center text-sm text-slate-400 sm:px-8">
          アンケートを読み込んでいます...
        </main>
      );
    }
    if (destination === "answer" && detailState === "unsupported") {
      return <Guidance kind="unsupported" onBack={() => setSelectedSurvey(null)} />;
    }
    if (destination === "answer" && detailState === "error") {
      return <Guidance kind="load-error" onBack={() => setSelectedSurvey(null)} />;
    }
    if (destination !== "answer") {
      return <Guidance kind={destination} onBack={() => setSelectedSurvey(null)} />;
    }
  }

  return (
    <Home
      surveys={surveys}
      loadError={loadError}
      isLoading={isLoading}
      onOpenSurvey={(survey) => void openSurvey(survey)}
      onRetry={() => void loadSurveys()}
    />
  );
}
