import type { ProfileSummaryVersioning } from "../model/profile-summary";

const SWIPE_THRESHOLD_PX = 72;
const MAX_DRAG_PX = 160;

type ProfileSummarySwipeAction = { type: "none" } | { type: "select"; versionId: string };

export function summaryCardDragOffset(deltaX: number, deltaY: number): number {
  if (Math.abs(deltaY) >= Math.abs(deltaX)) return 0;
  return Math.max(-MAX_DRAG_PX, Math.min(MAX_DRAG_PX, deltaX));
}

export function resolveProfileSummarySwipe({
  deltaX,
  deltaY,
  versioning,
}: {
  deltaX: number;
  deltaY: number;
  versioning: ProfileSummaryVersioning;
}): ProfileSummarySwipeAction {
  if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) {
    return { type: "none" };
  }

  const selectedIndex = versioning.versions.findIndex(
    ({ id }) => id === versioning.selectedVersionId,
  );
  if (selectedIndex < 0) return { type: "none" };

  if (deltaX < 0) {
    const olderVersion = versioning.versions[selectedIndex + 1];
    return olderVersion ? { type: "select", versionId: olderVersion.id } : { type: "none" };
  }

  const newerVersion = versioning.versions[selectedIndex - 1];
  if (newerVersion) return { type: "select", versionId: newerVersion.id };
  return { type: "none" };
}
