import { ArrowLeft, ArrowRight } from "lucide-react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useRef } from "react";
import {
  type DragOffset,
  SWIPE_TRANSITION_MS,
  buildDragTransform,
  buildFlyOutTransform,
  resolveChoiceProgress,
  resolveStackLayer,
} from "../survey/swipe";
import type { SurveyQuestion, SwipeDirection } from "../survey/types";
import { SurveyIcon } from "./survey-icon";

interface SwipeCardProps {
  question: SurveyQuestion;
  /** 重なりの奥行き。0 が最前面で、最前面だけドラッグできます。 */
  depth: number;
  /** ドラッグ中の移動量。ドラッグしていなければ `null`。 */
  drag: DragOffset | null;
  /** 確定して飛ばしている方向。飛ばしていなければ `null`。 */
  flyOut: SwipeDirection | null;
  cardWidth: number;
  threshold: number;
  reducedMotion: boolean;
  disabled: boolean;
  onSelect: (direction: SwipeDirection) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

/** タップとドラッグを区別する移動量。小さな指ぶれはタップとして扱います。 */
const TAP_SLOP_PX = 8;

/** カード内の選択ボタン。ボタン上から始めたスワイプは親カードへ伝えます。 */
function CardChoiceButton({
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
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(event) => {
        pointerStart.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
      onClick={(event) => {
        event.stopPropagation();
        const start = pointerStart.current;
        pointerStart.current = null;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) {
          // ドラッグ後に生成される click で、ボタン回答が重複しないようにします。
          event.preventDefault();
          return;
        }
        onSelect(direction);
      }}
      className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl border px-3 py-3 text-sm leading-tight font-semibold transition-colors disabled:opacity-40 ${
        isLeft
          ? "border-indigo-400/40 bg-indigo-400/10 text-indigo-200 hover:bg-indigo-400/20"
          : "border-sky-400/40 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20"
      }`}
    >
      {isLeft && <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />}
      <span className="flex flex-col items-center gap-1">
        <SurveyIcon name={choice.icon} className="size-4" />
        {choice.label}
      </span>
      {!isLeft && <ArrowRight className="size-4 shrink-0" aria-hidden="true" />}
    </button>
  );
}

/** 選択予告のオーバーレイ。ドラッグ量に応じて濃くなります。 */
function ChoiceOverlay({
  question,
  direction,
  progress,
}: {
  question: SurveyQuestion;
  direction: SwipeDirection;
  progress: number;
}) {
  const choice = direction === "left" ? question.left : question.right;
  const isLeft = direction === "left";

  return (
    <div
      // 左へスワイプ中は右上、右へスワイプ中は左上へ出して、指で隠れない位置に置きます。
      className={`pointer-events-none absolute top-6 flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-lg font-bold ${
        isLeft
          ? "right-5 rotate-12 border-indigo-400 text-indigo-300"
          : "left-5 -rotate-12 border-sky-400 text-sky-300"
      }`}
      style={{ opacity: progress }}
      aria-hidden="true"
    >
      <SurveyIcon name={choice.icon} className="size-5" />
      {choice.label}
    </div>
  );
}

export function SwipeCard({
  question,
  depth,
  drag,
  flyOut,
  cardWidth,
  threshold,
  reducedMotion,
  disabled,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: SwipeCardProps) {
  const isFront = depth === 0;
  const layer = resolveStackLayer(depth);

  const style: CSSProperties = {
    zIndex: layer.zIndex,
    opacity: layer.opacity,
    transform: layer.transform,
    // ドラッグ中は指へ即座に追従させるため transition を切ります。
    transition: reducedMotion || drag ? undefined : `transform ${SWIPE_TRANSITION_MS}ms ease-out`,
  };

  if (isFront && flyOut) {
    style.transform = buildFlyOutTransform(flyOut, cardWidth);
    style.opacity = 0;
    style.transition = reducedMotion
      ? undefined
      : `transform ${SWIPE_TRANSITION_MS}ms ease-out, opacity ${SWIPE_TRANSITION_MS}ms ease-out`;
  } else if (isFront && drag) {
    style.transform = buildDragTransform(drag, cardWidth);
  }

  const progress = drag ? resolveChoiceProgress(drag.dx, threshold) : 0;
  const pendingDirection: SwipeDirection | null =
    drag && drag.dx !== 0 ? (drag.dx > 0 ? "right" : "left") : null;

  return (
    <div
      className={`absolute inset-0 flex flex-col justify-between rounded-3xl border border-slate-700 bg-slate-800 p-6 shadow-2xl shadow-slate-950/50 select-none ${
        isFront ? "cursor-grab touch-none active:cursor-grabbing" : "pointer-events-none"
      }`}
      style={style}
      onPointerDown={isFront ? onPointerDown : undefined}
      onPointerMove={isFront ? onPointerMove : undefined}
      onPointerUp={isFront ? onPointerUp : undefined}
      onPointerCancel={isFront ? onPointerUp : undefined}
    >
      {pendingDirection && (
        <ChoiceOverlay question={question} direction={pendingDirection} progress={progress} />
      )}

      {/* 上部は選択予告のオーバーレイが出る帯なので、質問文はその下から始めます。 */}
      <p className="pt-14 text-xl leading-relaxed font-bold text-slate-50">{question.text}</p>

      <div>
        {question.hint && <p className="mb-4 text-sm text-slate-400">{question.hint}</p>}

        <div className="flex gap-3 border-t border-slate-700 pt-4">
          <CardChoiceButton
            question={question}
            direction="left"
            disabled={disabled || !isFront}
            onSelect={onSelect}
          />
          <CardChoiceButton
            question={question}
            direction="right"
            disabled={disabled || !isFront}
            onSelect={onSelect}
          />
        </div>
      </div>
    </div>
  );
}
