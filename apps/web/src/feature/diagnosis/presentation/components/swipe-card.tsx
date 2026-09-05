import { type CSSProperties, type PointerEvent as ReactPointerEvent, useRef } from "react";
import type { DiagnosisQuestion, SwipeDirection } from "../../model/types";
import {
  type DragOffset,
  SWIPE_TRANSITION_MS,
  buildDragTransform,
  buildFlyOutTransform,
  buildTurnOverPreviewTransform,
  buildTurnOverTransform,
  isTapGesture,
  resolveChoiceProgress,
  resolveStackLayer,
} from "../swipe";

type SwipeQuestion = Exclude<DiagnosisQuestion, { format: "likert_5" }>;
type CardFace = "single" | "behavior" | "value";

interface SwipeCardProps {
  question: SwipeQuestion;
  /** 表面から回答したときに回転して表示する「大切にしたいこと」の質問。 */
  backsideQuestion?: SwipeQuestion;
  face: CardFace;
  /** 重なりの奥行き。0 が最前面で、最前面だけドラッグできます。 */
  depth: number;
  /** ドラッグ中の移動量。ドラッグしていなければ`null`。 */
  drag: DragOffset | null;
  /** 確定して飛ばしている方向。飛ばしていなければ`null`。 */
  flyOut: SwipeDirection | null;
  /** 表面から裏面へ回転している方向。回転していなければ`null`。 */
  turnOver: SwipeDirection | null;
  cardWidth: number;
  threshold: number;
  reducedMotion: boolean;
  disabled: boolean;
  onSelect: (direction: SwipeDirection) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

/** カード内の選択ボタン。ボタン上から始めたスワイプは親カードへ伝えます。 */
function CardChoiceButton({
  question,
  direction,
  disabled,
  onSelect,
}: {
  question: SwipeQuestion;
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
        if (start && !isTapGesture({ dx: event.clientX - start.x, dy: event.clientY - start.y })) {
          // ドラッグ後に生成されるclickで、ボタン回答が重複しないようにします。
          event.preventDefault();
          return;
        }
        onSelect(direction);
      }}
      className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl border px-3 py-3 text-sm leading-tight font-semibold transition-colors disabled:opacity-40 ${
        isLeft
          ? "border-indigo-400/40 bg-indigo-400/10 text-indigo-700 hover:bg-indigo-400/20 dark:text-indigo-200"
          : "border-sky-400/40 bg-sky-400/10 text-sky-700 hover:bg-sky-400/20 dark:text-sky-200"
      }`}
    >
      {choice.label}
    </button>
  );
}

/** 選択予告のオーバーレイ。ドラッグ量に応じて濃くなります。 */
function ChoiceOverlay({
  question,
  direction,
  progress,
  paired,
}: {
  question: SwipeQuestion;
  direction: SwipeDirection;
  progress: number;
  paired: boolean;
}) {
  const choice = direction === "left" ? question.left : question.right;
  const isLeft = direction === "left";

  return (
    <div
      // 左へスワイプ中は右上、右へスワイプ中は左上へ出して、指で隠れない位置に置きます。
      className={`pointer-events-none absolute flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-lg font-bold ${
        paired ? "top-16" : "top-6"
      } ${
        isLeft
          ? "right-5 rotate-12 border-indigo-400 text-indigo-700 dark:text-indigo-300"
          : "left-5 -rotate-12 border-sky-400 text-sky-700 dark:text-sky-300"
      }`}
      style={{ opacity: progress }}
      aria-hidden="true"
    >
      {choice.label}
    </div>
  );
}

function FaceIndicator({ face }: { face: Exclude<CardFace, "single"> }) {
  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-[11px] font-semibold dark:bg-slate-900/70"
      aria-label={face === "behavior" ? "普段の行動 1/2" : "大切にしたいこと 2/2"}
    >
      <span
        className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-center ${
          face === "behavior"
            ? "bg-sky-100 text-sky-800 shadow-sm dark:bg-sky-950 dark:text-sky-200"
            : "text-slate-500 dark:text-slate-400"
        }`}
      >
        <span aria-hidden="true">{face === "behavior" ? "●" : "○"}</span>
        普段の行動
      </span>
      <span
        className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-center ${
          face === "value"
            ? "bg-violet-100 text-violet-800 shadow-sm dark:bg-violet-950 dark:text-violet-200"
            : "text-slate-500 dark:text-slate-400"
        }`}
      >
        <span aria-hidden="true">{face === "value" ? "●" : "○"}</span>
        大切にしたいこと
      </span>
    </div>
  );
}

function SwipeCardFace({
  question,
  face,
  pendingDirection,
  progress,
  disabled,
  onSelect,
  hidden,
  style,
}: {
  question: SwipeQuestion;
  face: CardFace;
  pendingDirection: SwipeDirection | null;
  progress: number;
  disabled: boolean;
  onSelect: (direction: SwipeDirection) => void;
  hidden: boolean;
  style: CSSProperties;
}) {
  const paired = face !== "single";

  return (
    <div
      className="absolute inset-0 flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-950/50 select-none dark:border-slate-700 dark:bg-slate-800"
      style={style}
      aria-hidden={hidden || undefined}
    >
      {pendingDirection && (
        <ChoiceOverlay
          question={question}
          direction={pendingDirection}
          progress={progress}
          paired={paired}
        />
      )}

      <div>
        {face !== "single" && <FaceIndicator face={face} />}
        <p
          className={`${paired ? "pt-9" : "pt-14"} text-xl leading-relaxed font-bold text-slate-950 dark:text-slate-50`}
        >
          {question.text}
        </p>
      </div>

      <div>
        {question.hint && (
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">{question.hint}</p>
        )}

        <div className="flex gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
          <CardChoiceButton
            question={question}
            direction="left"
            disabled={disabled}
            onSelect={onSelect}
          />
          <CardChoiceButton
            question={question}
            direction="right"
            disabled={disabled}
            onSelect={onSelect}
          />
        </div>
      </div>
    </div>
  );
}

export function SwipeCard({
  question,
  backsideQuestion,
  face,
  depth,
  drag,
  flyOut,
  turnOver,
  cardWidth,
  threshold,
  reducedMotion,
  disabled,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: SwipeCardProps) {
  const isFront = depth === 0;
  const previewsTurnOver = isFront && face === "behavior" && backsideQuestion !== undefined;
  const layer = resolveStackLayer(depth);

  const style: CSSProperties = {
    zIndex: layer.zIndex,
    opacity: layer.opacity,
    transform: layer.transform,
    // ドラッグ中は指へ即座に追従させるためtransitionを切ります。
    transition: reducedMotion || drag ? undefined : `transform ${SWIPE_TRANSITION_MS}ms ease-out`,
    perspective: "1200px",
  };

  if (isFront && flyOut) {
    style.transform = buildFlyOutTransform(flyOut, cardWidth);
    style.opacity = 0;
    style.transition = reducedMotion
      ? undefined
      : `transform ${SWIPE_TRANSITION_MS}ms ease-out, opacity ${SWIPE_TRANSITION_MS}ms ease-out`;
  } else if (isFront && drag && !previewsTurnOver) {
    style.transform = buildDragTransform(drag, cardWidth);
  }

  const progress = drag ? resolveChoiceProgress(drag.dx, threshold) : 0;
  const pendingDirection: SwipeDirection | null =
    drag && drag.dx !== 0 ? (drag.dx > 0 ? "right" : "left") : null;
  const flipperStyle: CSSProperties = {
    height: "100%",
    position: "relative",
    transformStyle: "preserve-3d",
    transform: turnOver
      ? buildTurnOverTransform(turnOver)
      : previewsTurnOver && drag
        ? buildTurnOverPreviewTransform(drag.dx, threshold)
        : undefined,
    transition: reducedMotion
      ? undefined
      : turnOver
        ? `transform ${SWIPE_TRANSITION_MS}ms ease-in-out`
        : previewsTurnOver && !drag
          ? `transform ${SWIPE_TRANSITION_MS}ms ease-out`
          : undefined,
  };
  const frontFaceStyle: CSSProperties = { backfaceVisibility: "hidden" };
  const backFaceStyle: CSSProperties = {
    backfaceVisibility: "hidden",
    transform: "rotateY(180deg)",
  };

  return (
    <div
      className={`absolute inset-0 ${
        isFront ? "cursor-grab touch-none active:cursor-grabbing" : "pointer-events-none"
      }`}
      style={style}
      onPointerDown={isFront ? onPointerDown : undefined}
      onPointerMove={isFront ? onPointerMove : undefined}
      onPointerUp={isFront ? onPointerUp : undefined}
      onPointerCancel={isFront ? onPointerCancel : undefined}
    >
      <div style={flipperStyle}>
        <SwipeCardFace
          question={question}
          face={face}
          pendingDirection={pendingDirection}
          progress={progress}
          disabled={disabled || !isFront}
          onSelect={onSelect}
          hidden={false}
          style={frontFaceStyle}
        />
        {backsideQuestion && (
          <SwipeCardFace
            question={backsideQuestion}
            face="value"
            pendingDirection={null}
            progress={0}
            disabled
            onSelect={onSelect}
            hidden
            style={backFaceStyle}
          />
        )}
      </div>
    </div>
  );
}
