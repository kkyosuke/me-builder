import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Keyboard,
  RotateCcw,
  SkipForward,
  Sparkles,
} from "lucide-react";
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
  resolveSwipeDirection,
  resolveSwipeThreshold,
} from "../survey/swipe";
import type { SurveyInteraction, SurveyQuestion, SwipeDirection } from "../survey/types";
import { SurveyIcon } from "./survey-icon";
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

/** 選択ボタン。スワイプできない環境でも同じ回答ができるようにします。 */
function ChoiceButton({
  question,
  direction,
  disabled,
  onSelect,
}: {
  question: SurveyQuestion;
  direction: SwipeDirection;
  disabled: boolean;
  onSelect: (direction: SwipeDirection) => void;
}) {
  const choice = direction === "left" ? question.left : question.right;
  const isLeft = direction === "left";

  return (
    <button
      type="button"
      onClick={() => onSelect(direction)}
      disabled={disabled}
      // min-w-0 が無いと、ラベルの最小幅の分だけ横へはみ出します。
      className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl border px-3 py-3 text-sm leading-tight font-semibold transition-colors disabled:opacity-40 ${
        isLeft
          ? "border-indigo-400/40 bg-indigo-400/10 text-indigo-200 hover:bg-indigo-400/20"
          : "border-sky-400/40 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20"
      }`}
    >
      {isLeft && <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />}
      {/*
       * アイコンとラベルを縦に積みます。横並びにすると狭い画面でラベルが折り返され、
       * 日本語が語中で割れて読みにくくなります。長いラベルは切り詰めずに折り返します。
       */}
      <span className="flex flex-col items-center gap-1">
        <SurveyIcon name={choice.icon} className="size-4" />
        {choice.label}
      </span>
      {!isLeft && <ArrowRight className="size-4 shrink-0" aria-hidden="true" />}
    </button>
  );
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
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-3xl border border-slate-700 bg-slate-800 p-4 text-center">
      {/* shrink-0 が無いと、縦の flex の中で高さだけが縮んでアイコンが潰れます。 */}
      <CircleCheck className="size-12 shrink-0 text-emerald-400" aria-hidden="true" />
      <p className="text-lg font-bold">回答から見える現在の傾向</p>
      <p className="text-sm text-slate-400">
        {`${answered} 問に回答し、${deferred} 問をあとで回答にしました。`}
      </p>
      <div className="grid w-full grid-cols-2 gap-2">
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
      <p className="text-[10px] text-slate-500">
        回答と結果のサーバー保存はまだ実装されていません。
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
    // 途中で指が要素の外へ出てもイベントを受け取り続けます。
    event.currentTarget.setPointerCapture(event.pointerId);
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

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }
    dragStart.current = null;

    const direction = resolveSwipeDirection(event.clientX - start.x, threshold);
    if (direction) {
      commit(direction);
      return;
    }
    // しきい値未満なので元位置へ戻します（transition が効きます）。
    setDrag(null);
  };

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

      {/* カードの重なり。高さを固定して、カードを絶対配置で重ねます。 */}
      <div ref={stackRef} className="relative h-80">
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
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
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
          <div className="flex gap-3">
            <ChoiceButton question={current} direction="left" disabled={isBusy} onSelect={commit} />
            <ChoiceButton
              question={current}
              direction="right"
              disabled={isBusy}
              onSelect={commit}
            />
          </div>

          <button
            type="button"
            onClick={() => commit("skip")}
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 px-4 py-2.5 text-sm text-slate-400 transition-colors hover:bg-slate-800 disabled:opacity-40"
          >
            <SkipForward className="size-4" aria-hidden="true" />
            あとで回答する
          </button>

          <p className="flex flex-wrap items-center justify-center gap-x-2 text-center text-xs text-slate-500">
            <Keyboard className="size-4 shrink-0" aria-hidden="true" />
            スワイプ / ← → で回答、↓ であとで回答
          </p>
        </div>
      )}
    </section>
  );
}
