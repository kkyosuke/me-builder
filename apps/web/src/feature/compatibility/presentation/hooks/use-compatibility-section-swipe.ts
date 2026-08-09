import { type PointerEvent as ReactPointerEvent, useCallback, useRef } from "react";
import { resolveCompatibilitySectionSwipe } from "../compatibility-section-swipe";

type SwipeStart = {
  pointerId: number;
  x: number;
  y: number;
};

export function useCompatibilitySectionSwipe({
  showPair,
  showPeople,
}: {
  showPair: () => void;
  showPeople: () => void;
}) {
  const start = useRef<SwipeStart | null>(null);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    start.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }, []);

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const swipeStart = start.current;
      if (!swipeStart || swipeStart.pointerId !== event.pointerId) return;
      start.current = null;

      const direction = resolveCompatibilitySectionSwipe({
        cancelled,
        dx: event.clientX - swipeStart.x,
        dy: event.clientY - swipeStart.y,
      });
      if (direction === "left") showPair();
      if (direction === "right") showPeople();
    },
    [showPair, showPeople],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => finish(event, false),
    [finish],
  );
  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => finish(event, true),
    [finish],
  );

  return { onPointerDown, onPointerUp, onPointerCancel };
}
