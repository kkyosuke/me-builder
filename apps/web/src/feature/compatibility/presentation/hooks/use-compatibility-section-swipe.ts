import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  resolveCompatibilitySectionDrag,
  resolveCompatibilitySectionSwipe,
} from "../compatibility-section-swipe";

type CompatibilityResultSection = "pair" | "people";

type SwipeStart = {
  pointerId: number;
  viewportWidth: number;
  x: number;
  y: number;
};

const CLICK_SUPPRESSION_DISTANCE_PX = 8;
const FALLBACK_VIEWPORT_WIDTH_PX = 320;

export function useCompatibilitySectionSwipe({
  section,
  showSection,
}: {
  section: CompatibilityResultSection;
  showSection: (section: CompatibilityResultSection) => void;
}) {
  const start = useRef<SwipeStart | null>(null);
  const suppressClick = useRef(false);
  const clickResetTimer = useRef<number | undefined>(undefined);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(1);

  useEffect(
    () => () => {
      if (clickResetTimer.current !== undefined) window.clearTimeout(clickResetTimer.current);
    },
    [],
  );

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (clickResetTimer.current !== undefined) window.clearTimeout(clickResetTimer.current);
    suppressClick.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const measuredWidth = event.currentTarget.getBoundingClientRect().width;
    const width = measuredWidth > 0 ? measuredWidth : FALLBACK_VIEWPORT_WIDTH_PX;
    setViewportWidth(width);
    setDragOffset(0);
    start.current = {
      pointerId: event.pointerId,
      viewportWidth: width,
      x: event.clientX,
      y: event.clientY,
    };
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const swipeStart = start.current;
      if (!swipeStart || swipeStart.pointerId !== event.pointerId) return;
      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      if (Math.abs(dx) > Math.abs(dy)) event.preventDefault();
      setDragOffset(
        resolveCompatibilitySectionDrag({
          activeIndex: section === "people" ? 0 : 1,
          dx,
          viewportWidth: swipeStart.viewportWidth,
        }),
      );
    },
    [section],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const swipeStart = start.current;
      if (!swipeStart || swipeStart.pointerId !== event.pointerId) return;
      start.current = null;
      setDragOffset(null);

      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      suppressClick.current = Math.abs(dx) > CLICK_SUPPRESSION_DISTANCE_PX;
      if (suppressClick.current) {
        clickResetTimer.current = window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }

      const direction = resolveCompatibilitySectionSwipe({ cancelled, dx, dy });
      if (direction === "left" && section === "people") showSection("pair");
      if (direction === "right" && section === "pair") showSection("people");
    },
    [section, showSection],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => finish(event, false),
    [finish],
  );
  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => finish(event, true),
    [finish],
  );
  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    dragOffset,
    handlers: { onClickCapture, onPointerCancel, onPointerDown, onPointerMove, onPointerUp },
    viewportWidth,
  };
}
