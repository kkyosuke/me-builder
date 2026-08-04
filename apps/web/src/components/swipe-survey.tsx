import { CircleCheck, Keyboard, RotateCcw, SkipForward, Sparkles } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createDeferredQuestion,
  createSurveyAnswer,
  summarizeInteractions,
} from "../survey/answers";
import { getParameterSummary } from "../survey/parameter-scoring";
import { pickProgressMessage, resolveProgressMilestone } from "../survey/progress-message";
import type { SurveyDefinition } from "../survey/questions";
import {
  type DragOffset,
  SWIPE_TRANSITION_MS,
  VISIBLE_STACK_SIZE,
  resolveKeyAction,
  resolveSwipeRelease,
  resolveSwipeThreshold,
} from "../survey/swipe";
import type { SurveyInteraction, SwipeDirection } from "../survey/types";
import { SwipeCard } from "./swipe-card";

/** 回答の確定に使える操作。スワイプ以外の手段も同じ関数へ流します。 */
type SurveyAction = SwipeDirection | "skip";

/** `prefers-reduced-motion: reduce` を購読します。 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/** しきい値をカード幅から決めるため、カードの実寸を測ります。 */
function useCardWidth(): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    setWidth(element.offsetWidth);
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** 全問終わったときの表示。 */
function SurveyComplete({
  interactions,
  survey,
}: {
  interactions: SurveyInteraction[];
  survey: SurveyDefinition;
}) {
  const { answered, deferred } = summarizeInteractions(interactions);
  const profile = survey.score(interactions);

  return (
    <div className="min-h-80 rounded-3xl border border-slate-700 bg-slate-800 p-5 text-center">
      <div className="flex flex-col items-center gap-2">
        <CircleCheck className="size-12 text-emerald-400" aria-hidden="true" />
        <p className="text-lg font-bold">未保存の選択から見える現在の傾向</p>
        <p className="text-sm text-slate-400">
          {`${answered} 問に回答し、${deferred} 問をあとで回答にしました。`}
        </p>
      </div>

      <div className="mt-4 grid w-full grid-cols-2 gap-2">
        {profile.parameters.map((parameter) => (
          <div key={parameter.id} className="rounded-xl bg-slate-900/70 p-2">
            <p className="text-xs text-slate-400">{parameter.label}</p>
            <p className="font-semibold text-sky-300">
              {parameter.score === null ? "—" : `${parameter.score} / 100`}
            </p>
            <p className="text-xs text-slate-300">
              {getParameterSummary(parameter, survey.balancedLabel)}
            </p>
            <p className="text-[10px] text-slate-500">{`回答充足度 ${parameter.coverage}%`}</p>
          </div>
        ))}
      </div>

      <p className="mt-4 border-t border-slate-700 pt-3 text-xs font-semibold text-amber-200">
        この内容はサーバーへ保存されていません。画面を離れると失われます。
      </p>
    </div>
  );
}

/**
 * スワイプアンケートの本体。
 *
 * 1 問 1 画面で、カードを縦に重ねて最前面をドラッグします。スワイプ以外に選択ボタンと
 * キーボード（←／→、↓ であとで回答）でも回答できます。LINE 内は LIFF が主導線ですが
 * 外部ブラウザの導線も維持しているため（[プロジェクト概要 §4](../../../../docs/product/project-overview.md#4-想定する利用体験)）、
 * どちらでも操作できる状態を保ちます。
 */
export function SwipeSurvey({
  survey,
  onBack,
}: {
  survey: SurveyDefinition;
  onBack: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [interactions, setInteractions] = useState<SurveyInteraction[]>([]);
  const [drag, setDrag] = useState<DragOffset | null>(null);
  const [flyOut, setFlyOut] = useState<SwipeDirection | null>(null);

  const reducedMotion = useReducedMotion();
  const [stackRef, cardWidth] = useCardWidth();
  const threshold = resolveSwipeThreshold(cardWidth);

  /** ドラッグの開始位置。再描画のたびに作り直さないよう ref で持ちます。 */
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  /** 飛ばしている間の待ちタイマー。アンマウント時に解除します。 */
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const questions = survey.questions;

  useEffect(
    () => () => {
      if (advanceTimer.current) {
        clearTimeout(advanceTimer.current);
      }
    },
    [],
  );

  const current = questions?.[index];
  const isBusy = flyOut !== null;

  /** スワイプ・ボタン・キーボードのすべてがここへ集まります。 */
  const commit = useCallback(
    (action: SurveyAction) => {
      if (!current || isBusy) {
        return;
      }

      const interaction =
        action === "skip"
          ? createDeferredQuestion(current, new Date())
          : createSurveyAnswer(current, action, new Date());
      setInteractions((previous) => [...previous, interaction]);
      setDrag(null);

      // スキップは方向を持たないので飛ばさず、すぐ次の質問へ進めます。
      // `prefers-reduced-motion` のときも飛ばすアニメーションを省いて即座に進めます。
      if (action === "skip" || reducedMotion) {
        setIndex((previous) => previous + 1);
        return;
      }

      setFlyOut(action);
      advanceTimer.current = setTimeout(() => {
        setIndex((previous) => previous + 1);
        setFlyOut(null);
        advanceTimer.current = null;
      }, SWIPE_TRANSITION_MS);
    },
    [current, isBusy, reducedMotion],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveKeyAction(event.key);
      if (!action) {
        return;
      }
      // 矢印キーでの画面スクロールを止めて、回答の操作に割り当てます。
      event.preventDefault();
      commit(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commit]);

  const restart = useCallback(() => {
    setIndex(0);
    setInteractions([]);
    setDrag(null);
    setFlyOut(null);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isBusy) {
      return;
    }
    // 押した子要素でキャプチャすることで、ボタン上からのスワイプと通常のクリックを両立します。
    const captureTarget = event.target instanceof Element ? event.target : event.currentTarget;
    captureTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    setDrag({ dx: 0, dy: 0 });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }
    setDrag({ dx: event.clientX - start.x, dy: event.clientY - start.y });
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }
    dragStart.current = null;

    const direction = resolveSwipeRelease(event.clientX - start.x, threshold, cancelled);
    if (direction) {
      commit(direction);
      return;
    }
    // しきい値未満なので元位置へ戻します（transition が効きます）。
    setDrag(null);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => finishPointer(event, false);
  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => finishPointer(event, true);

  const total = questions.length;
  const finished = index >= total;
  const answeredCount = finished ? total : index;
  const progressMilestone = resolveProgressMilestone(answeredCount, total);
  // 同じ段階にいる間は文言を固定し、回答のたびにちらつかないようにします。
  const progressMessage = useMemo(
    () => (progressMilestone ? pickProgressMessage(progressMilestone) : null),
    [progressMilestone],
  );

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">{survey.title}</h2>
        <p className="text-sm text-slate-400" aria-live="polite">
          {`${finished ? total : Math.min(index + 1, total)} / ${total}`}
        </p>
      </header>

      <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
        <div
          className="h-full rounded-full bg-sky-400"
          style={{
            width: total === 0 ? "0%" : `${(answeredCount / total) * 100}%`,
            transition: reducedMotion ? undefined : "width 260ms ease-out",
          }}
        />
      </div>

      <div className="min-h-10" aria-live="polite">
        {progressMessage && (
          <p className="flex items-center gap-2 rounded-xl bg-sky-400/10 px-3 py-2 text-sm text-sky-200">
            <Sparkles className="size-4 shrink-0" aria-hidden="true" />
            {progressMessage}
          </p>
        )}
      </div>

      {/* 回答中だけ高さを固定してカードを重ね、完了後は結果の項目数に応じて伸ばします。 */}
      <div ref={stackRef} className={finished ? "relative" : "relative mb-3 h-80"}>
        {finished && <SurveyComplete interactions={interactions} survey={survey} />}
        {questions?.slice(index, index + VISIBLE_STACK_SIZE).map((question, offset) => (
          <SwipeCard
            key={`${question.surveyQuestionId}-v${question.questionVersion}`}
            question={question}
            depth={offset}
            drag={offset === 0 ? drag : null}
            flyOut={offset === 0 ? flyOut : null}
            cardWidth={cardWidth}
            threshold={threshold}
            reducedMotion={reducedMotion}
            disabled={isBusy}
            onSelect={commit}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          />
        ))}
      </div>

      {finished && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 rounded-2xl border border-slate-600 px-4 py-3 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800"
          >
            一覧へ
          </button>
          <button
            type="button"
            onClick={restart}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-400"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            もう一度
          </button>
        </div>
      )}

      {current && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => commit("skip")}
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 px-4 py-2.5 text-sm text-slate-400 transition-colors hover:bg-slate-800 disabled:opacity-40"
          >
            <SkipForward className="size-4" aria-hidden="true" />
            あとで回答する
          </button>

          <div className="space-y-1 text-center text-xs text-slate-500">
            <p>「はい」「いいえ」をタップ、またはカードを左右にスワイプ</p>
            <p className="flex flex-wrap items-center justify-center gap-x-2">
              <Keyboard className="size-4 shrink-0" aria-hidden="true" />
              キーボードは ← → で回答、↓ であとで回答
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
