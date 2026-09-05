import {
  CircleCheck,
  Keyboard,
  LoaderCircle,
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
  createDiagnosisAnswer,
  createLikert5DiagnosisAnswer,
  summarizeInteractions,
} from "../../model/answers";
import type { DiagnosisDefinition } from "../../model/diagnosis-definition";
import type { DiagnosisAnswer, DiagnosisInteraction, SwipeDirection } from "../../model/types";
import { pickProgressMessage, resolveProgressMilestone } from "../progress-message";
import {
  type DragOffset,
  SWIPE_TRANSITION_MS,
  VISIBLE_STACK_SIZE,
  resolveKeyAction,
  resolveSwipeRelease,
  resolveSwipeThreshold,
} from "../swipe";
import { SwipeCard } from "./swipe-card";

/** 回答の確定に使える操作。スワイプ以外の手段も同じ関数へ流します。 */
type DiagnosisAction = SwipeDirection | "skip";

type BackgroundSave = {
  answer: DiagnosisAnswer;
  state: "saving" | "failed";
  message?: string;
};

function Likert5Card({
  question,
  disabled,
  onSelect,
}: {
  question: Extract<DiagnosisDefinition["questions"][number], { format: "likert_5" }>;
  disabled: boolean;
  onSelect: (choiceId: string) => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-950/50 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-xl leading-relaxed font-bold text-slate-950 dark:text-slate-50">
        {question.text}
      </p>
      {question.hint && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{question.hint}</p>
      )}
      <div className="mt-auto grid gap-2" aria-label="当てはまる程度を選択">
        {question.choices.map((choice, index) => (
          <button
            key={choice.choiceId}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(choice.choiceId)}
            className="rounded-xl border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-left text-sm font-semibold text-sky-800 transition-colors hover:bg-sky-400/20 disabled:opacity-40 dark:text-sky-100"
          >
            <span className="mr-2 text-xs text-slate-500 dark:text-slate-400">{index + 1}</span>
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

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
function DiagnosisComplete({
  interactions,
}: {
  interactions: DiagnosisInteraction[];
}) {
  const { answered, deferred } = summarizeInteractions(interactions);

  return (
    <div className="min-h-80 rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 text-center">
      <div className="flex flex-col items-center gap-2">
        <CircleCheck className="size-12 text-emerald-400" aria-hidden="true" />
        <p className="text-lg font-bold">今回の回答はここまでです</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {`${answered} 問に回答し、${deferred} 問をあとで回答にしました。`}
        </p>
      </div>

      {deferred > 0 && (
        <p className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-3 text-xs font-semibold text-amber-700 dark:text-amber-200">
          「あとで回答」の選択はまだ保存されません。
        </p>
      )}
    </div>
  );
}

/** 全問の操作後、バックグラウンド保存が完了するまで結果を確定させないための表示。 */
function SaveCompletionPending({
  saves,
  onRetry,
}: {
  saves: BackgroundSave[];
  onRetry: (answer: DiagnosisAnswer) => void;
}) {
  const failed = saves.filter(({ state }) => state === "failed");
  const savingCount = saves.length - failed.length;
  const retryFailed = () => {
    for (const { answer } of failed) {
      onRetry(answer);
    }
  };

  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-4 rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 text-center">
      {savingCount > 0 && (
        <LoaderCircle
          className="size-12 animate-spin text-sky-700 dark:text-sky-300 motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      <div>
        <p className="text-lg font-bold">
          {failed.length > 0 ? "保存できなかった回答があります" : "回答を保存しています"}
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {savingCount > 0
            ? `残り ${savingCount} 件の保存が終わるまでお待ちください。`
            : "保存に成功すると結果を表示します。"}
        </p>
      </div>
      {failed.length > 0 && (
        <div className="w-full rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-700 dark:text-red-200">
          <p>{failed[0]?.message ?? "回答を保存できませんでした。"}</p>
          <button
            type="button"
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-red-200 px-4 py-2 font-semibold text-slate-950 disabled:opacity-40"
            disabled={savingCount > 0}
            onClick={retryFailed}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            保存を再試行
          </button>
        </div>
      )}
    </div>
  );
}

/** 全回答の保存後、保存済みデータによる結果画面を取得している間の表示。 */
function ResultOpeningPending() {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-4 rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 text-center">
      <LoaderCircle
        className="size-12 animate-spin text-sky-700 dark:text-sky-300 motion-reduce:animate-none"
        aria-hidden="true"
      />
      <div>
        <p className="text-lg font-bold">回答結果を準備しています</p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          保存した回答を読み込んでいます。
        </p>
      </div>
    </div>
  );
}

/**
 * スワイプ診断の本体。
 *
 * 1 問 1 画面で、カードを縦に重ねて最前面をドラッグします。スワイプ以外に選択ボタンと
 * キーボード（←／→、↓ であとで回答）でも回答できます。LINE 内は LIFF が主導線ですが
 * 外部ブラウザの導線も維持しているため（[プロジェクト概要 §4](../../../../../../../docs/product/project-overview.md#4-想定する利用体験)）、
 * どちらでも操作できる状態を保ちます。
 */
export function SwipeDiagnosis({
  diagnosis,
  headingRef,
  initialAnswers = [],
  onBack,
  onSaveAnswer,
  onDeferQuestion,
  onComplete,
}: {
  diagnosis: DiagnosisDefinition;
  headingRef?: RefObject<HTMLHeadingElement>;
  initialAnswers?: DiagnosisAnswer[];
  onBack: () => void;
  onSaveAnswer: (answer: DiagnosisAnswer) => Promise<{ acceptedAt: string }>;
  onDeferQuestion: (diagnosisQuestionId: string) => Promise<void>;
  onComplete: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [interactions, setInteractions] = useState<DiagnosisInteraction[]>(initialAnswers);
  const [drag, setDrag] = useState<DragOffset | null>(null);
  const [flyOut, setFlyOut] = useState<SwipeDirection | null>(null);
  const [turnOver, setTurnOver] = useState<SwipeDirection | null>(null);
  const [backgroundSaves, setBackgroundSaves] = useState<BackgroundSave[]>([]);
  const [deferState, setDeferState] = useState<"idle" | "saving" | "failed">("idle");

  const reducedMotion = useReducedMotion();
  const [stackRef, cardWidth] = useCardWidth();
  const threshold = resolveSwipeThreshold(cardWidth);

  /** ドラッグの開始位置。再描画のたびに作り直さないよう ref で持ちます。 */
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  /** 飛ばしている間の待ちタイマー。アンマウント時に解除します。 */
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Reactの状態反映前に同じ質問へ二重操作されることを同期的に止めます。 */
  const actionPending = useRef(false);
  /** 保存完了後の結果遷移を再描画で重複通知しないようにします。 */
  const completionNotified = useRef(false);

  const answeredQuestionIds = useMemo(
    () => new Set(initialAnswers.map(({ diagnosisQuestionId }) => diagnosisQuestionId)),
    [initialAnswers],
  );
  const questions = useMemo(
    () =>
      diagnosis.questions.filter(
        ({ diagnosisQuestionId }) => !answeredQuestionIds.has(diagnosisQuestionId),
      ),
    [answeredQuestionIds, diagnosis.questions],
  );

  useEffect(
    () => () => {
      if (advanceTimer.current) {
        clearTimeout(advanceTimer.current);
      }
    },
    [],
  );

  const current = questions?.[index];
  const configuredBackside = useMemo(
    () =>
      current
        ? diagnosis.questions.find(
            (question) =>
              "backsideOfDiagnosisQuestionId" in question &&
              question.backsideOfDiagnosisQuestionId === current.diagnosisQuestionId,
          )
        : undefined,
    [current, diagnosis.questions],
  );
  const pendingBackside =
    configuredBackside?.diagnosisQuestionId === questions[index + 1]?.diagnosisQuestionId
      ? questions[index + 1]
      : undefined;
  const isBusy = flyOut !== null || turnOver !== null || deferState === "saving";

  const advance = useCallback(
    (direction: SwipeDirection, revealBackside: boolean) => {
      if (reducedMotion) {
        setIndex((previous) => previous + 1);
        queueMicrotask(() => {
          actionPending.current = false;
        });
        return;
      }
      if (revealBackside) {
        setTurnOver(direction);
      } else {
        setFlyOut(direction);
      }
      advanceTimer.current = setTimeout(() => {
        setIndex((previous) => previous + 1);
        setFlyOut(null);
        setTurnOver(null);
        advanceTimer.current = null;
        actionPending.current = false;
      }, SWIPE_TRANSITION_MS);
    },
    [reducedMotion],
  );

  const persistAnswer = useCallback(
    async (answer: DiagnosisAnswer) => {
      setBackgroundSaves((previous) => {
        const next = { answer, state: "saving" as const };
        return previous.some(
          ({ answer: pending }) => pending.diagnosisQuestionId === answer.diagnosisQuestionId,
        )
          ? previous.map((pending) =>
              pending.answer.diagnosisQuestionId === answer.diagnosisQuestionId ? next : pending,
            )
          : [...previous, next];
      });
      try {
        const saved = await onSaveAnswer(answer);
        setInteractions((previous) =>
          previous.map((interaction) =>
            interaction.kind === "answer" &&
            interaction.diagnosisQuestionId === answer.diagnosisQuestionId
              ? { ...interaction, acceptedAt: saved.acceptedAt }
              : interaction,
          ),
        );
        setBackgroundSaves((previous) =>
          previous.filter(
            ({ answer: pending }) => pending.diagnosisQuestionId !== answer.diagnosisQuestionId,
          ),
        );
      } catch (error) {
        setBackgroundSaves((previous) =>
          previous.map((pending) =>
            pending.answer.diagnosisQuestionId === answer.diagnosisQuestionId
              ? {
                  answer,
                  state: "failed",
                  message: error instanceof Error ? error.message : "回答を保存できませんでした。",
                }
              : pending,
          ),
        );
      }
    },
    [onSaveAnswer],
  );

  /** スワイプ・ボタン・キーボードのすべてがここへ集まります。 */
  const commit = useCallback(
    (action: DiagnosisAction) => {
      if (!current || isBusy || actionPending.current) {
        return;
      }

      actionPending.current = true;
      setDrag(null);

      if (action === "skip") {
        setDeferState("saving");
        void onDeferQuestion(current.diagnosisQuestionId).catch(() => {
          setDeferState("failed");
          actionPending.current = false;
        });
        return;
      }
      const answer = createDiagnosisAnswer(current, action, new Date());
      setInteractions((previous) => [...previous, answer]);
      advance(action, pendingBackside !== undefined);
      void persistAnswer(answer);
    },
    [advance, current, isBusy, onDeferQuestion, pendingBackside, persistAnswer],
  );

  const commitLikert5 = useCallback(
    (choiceId: string) => {
      if (!current || current.format !== "likert_5" || isBusy || actionPending.current) {
        return;
      }
      actionPending.current = true;
      const answer = createLikert5DiagnosisAnswer(current, choiceId, new Date());
      setInteractions((previous) => [...previous, answer]);
      setIndex((previous) => previous + 1);
      queueMicrotask(() => {
        actionPending.current = false;
      });
      void persistAnswer(answer);
    },
    [current, isBusy, persistAnswer],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (current?.format === "likert_5") {
        return;
      }
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
  }, [commit, current?.format]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isBusy || current?.format === "likert_5") {
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

  const total = diagnosis.questions.length;
  const finished = index >= questions.length;
  const allAnswered =
    interactions.filter((interaction) => interaction.kind === "answer").length === total;
  const isOpeningResult = finished && allAnswered && backgroundSaves.length === 0;
  const answeredCount = Math.min(initialAnswers.length + index, total);
  const progressMilestone = resolveProgressMilestone(answeredCount, total);
  // 同じ段階にいる間は文言を固定し、回答のたびにちらつかないようにします。
  const progressMessage = useMemo(
    () => (progressMilestone ? pickProgressMessage(progressMilestone) : null),
    [progressMilestone],
  );
  const visibleSwipeQuestions = useMemo(() => {
    const visible: Array<(typeof questions)[number]> = [];
    for (const question of questions.slice(index)) {
      if (pendingBackside?.diagnosisQuestionId === question.diagnosisQuestionId) continue;
      visible.push(question);
      if (visible.length >= VISIBLE_STACK_SIZE) break;
    }
    return visible;
  }, [index, pendingBackside, questions]);

  useEffect(() => {
    if (!finished || !allAnswered || backgroundSaves.length > 0 || completionNotified.current) {
      return;
    }
    completionNotified.current = true;
    onComplete();
  }, [allAnswered, backgroundSaves.length, finished, onComplete]);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">
          {diagnosis.title}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400" aria-live="polite">
          {`${finished ? total : Math.min(answeredCount + 1, total)} / ${total}`}
        </p>
      </header>

      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className="h-full rounded-full bg-sky-400"
          style={{
            width: total === 0 ? "0%" : `${(answeredCount / total) * 100}%`,
            transition: reducedMotion ? undefined : `width ${SWIPE_TRANSITION_MS}ms ease-out`,
          }}
        />
      </div>

      <div className="min-h-10" aria-live="polite">
        {progressMessage && (
          <p className="flex items-center gap-2 rounded-xl bg-sky-400/10 px-3 py-2 text-sm text-sky-700 dark:text-sky-200">
            <Sparkles className="size-4 shrink-0" aria-hidden="true" />
            {progressMessage}
          </p>
        )}
      </div>

      {/* 回答中だけ高さを固定してカードを重ね、完了後は結果の項目数に応じて伸ばします。 */}
      <div ref={stackRef} className={finished ? "relative" : "relative mb-3 h-80"}>
        {finished && backgroundSaves.length > 0 && (
          <SaveCompletionPending
            saves={backgroundSaves}
            onRetry={(answer) => void persistAnswer(answer)}
          />
        )}
        {isOpeningResult && <ResultOpeningPending />}
        {finished && backgroundSaves.length === 0 && !isOpeningResult && (
          <DiagnosisComplete interactions={interactions} />
        )}
        {current?.format === "likert_5" ? (
          <Likert5Card question={current} disabled={isBusy} onSelect={commitLikert5} />
        ) : (
          visibleSwipeQuestions.map((question, offset) =>
            question.format === "likert_5" ? null : (
              <SwipeCard
                key={`${question.diagnosisQuestionId}-v${question.questionVersion}`}
                question={question}
                {...(offset === 0 && pendingBackside && pendingBackside.format !== "likert_5"
                  ? { backsideQuestion: pendingBackside }
                  : {})}
                face={
                  question.backsideOfDiagnosisQuestionId
                    ? "value"
                    : offset === 0 && configuredBackside
                      ? "behavior"
                      : "single"
                }
                depth={offset}
                drag={offset === 0 ? drag : null}
                flyOut={offset === 0 ? flyOut : null}
                turnOver={offset === 0 ? turnOver : null}
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
            ),
          )
        )}
      </div>

      {finished && (
        <button
          type="button"
          onClick={onBack}
          className="w-full rounded-2xl border border-slate-300 dark:border-slate-600 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          一覧へ
        </button>
      )}

      {current && (
        <div className="flex flex-col gap-3">
          {deferState === "failed" && (
            <p
              className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
              role="alert"
            >
              あとで回答を保存できませんでした。同じ操作を再試行してください。
            </p>
          )}
          <button
            type="button"
            onClick={() => commit("skip")}
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            <SkipForward className="size-4" aria-hidden="true" />
            {deferState === "saving" ? "保存しています..." : "あとで回答する"}
          </button>

          <div className="space-y-1 text-center text-xs text-slate-500">
            <p>
              {current.format === "likert_5"
                ? "5つの選択肢をタップ、またはTabとEnterで選択"
                : "「はい」「いいえ」をタップ、またはカードを左右にスワイプ"}
            </p>
            <p className="flex flex-wrap items-center justify-center gap-x-2">
              <Keyboard className="size-4 shrink-0" aria-hidden="true" />
              {current.format === "likert_5"
                ? "キーボードはTabで移動、Enterで回答"
                : "キーボードは ← → で回答、↓ であとで回答"}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
