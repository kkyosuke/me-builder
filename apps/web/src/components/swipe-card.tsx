import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
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
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
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

        {/* 選択肢はスワイプ前から見えている必要があるため、カード下部にも並べます。 */}
        <div className="flex items-stretch gap-3 border-t border-slate-700 pt-4 text-sm">
          <div className="flex flex-1 items-center gap-2 text-indigo-300">
            <SurveyIcon name={question.left.icon} className="size-5 shrink-0" />
            <span>{question.left.label}</span>
          </div>
          <div className="flex flex-1 items-center justify-end gap-2 text-right text-sky-300">
            <span>{question.right.label}</span>
            <SurveyIcon name={question.right.icon} className="size-5 shrink-0" />
          </div>
        </div>
      </div>
    </div>
  );
}
