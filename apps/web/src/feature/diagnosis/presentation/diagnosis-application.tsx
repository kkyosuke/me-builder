import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useProfileProgression } from "../../profile/presentation/use-profile-progression";
import {
  createDiagnosisDetailHistoryState,
  diagnosisDetailIdFromHistoryState,
  diagnosisResultIdFromPathname,
  isDiagnosisResultPathname,
} from "../model/diagnosis-navigation";
import {
  type RelationshipCategoryFilter,
  relationshipCategoryFilterFromSearch,
} from "../model/relationship-category";
import { DiagnosisDetailScreen } from "./components/diagnosis-detail-screen";
import { DiagnosisGuidance } from "./components/diagnosis-guidance";
import { DiagnosisHome } from "./components/diagnosis-home";
import {
  DiagnosisAnswerSkeleton,
  DiagnosisIntroductionSkeleton,
  DiagnosisResultSkeleton,
} from "./components/diagnosis-loading-skeleton";
import { DiagnosisResultView } from "./components/diagnosis-result";
import { useDiagnosisDetail } from "./hooks/use-diagnosis-detail";
import { useDiagnosisList } from "./hooks/use-diagnosis-list";

export default function DiagnosisApplication() {
  const diagnoses = useDiagnosisList();
  const progression = useProfileProgression();
  const detail = useDiagnosisDetail({
    onProgress: diagnoses.updateProgress,
  });
  const [categoryFilter, setCategoryFilter] = useState<RelationshipCategoryFilter>(() =>
    relationshipCategoryFilterFromSearch(window.location.search),
  );
  const [isAnsweredOpen, setIsAnsweredOpen] = useState(false);
  const openedDirectDiagnosisId = useRef<string | null>(null);
  const openedHistoryDiagnosisId = useRef<string | null>(null);
  const isHistoryDetailOpen = useRef(
    diagnosisDetailIdFromHistoryState(window.history.state) !== null,
  );
  const listScrollY = useRef<number | null>(null);
  const shouldRestoreListScroll = useRef(false);
  const isDirectResultPath = isDiagnosisResultPathname(window.location.pathname);
  const directDiagnosisId = diagnosisResultIdFromPathname(window.location.pathname);
  const fromProfile = new URLSearchParams(window.location.search).get("from") === "me";
  const directBackHref = fromProfile ? "/me" : "/diagnosis";
  const directBackLabel = fromProfile ? "わたしのまとめへ" : "診断一覧へ";
  const directDiagnosis =
    directDiagnosisId && diagnoses.state.status === "success"
      ? diagnoses.state.data.find(({ id }) => id === directDiagnosisId)
      : undefined;

  const openDiagnosis = useCallback(
    (diagnosis: Parameters<typeof detail.open>[0]) => {
      if (isHistoryDetailOpen.current) return;
      listScrollY.current = window.scrollY;
      window.history.pushState(
        createDiagnosisDetailHistoryState(window.history.state, diagnosis.id),
        "",
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
      isHistoryDetailOpen.current = true;
      openedHistoryDiagnosisId.current = diagnosis.id;
      void detail.open(diagnosis);
    },
    [detail.open],
  );

  const closeDetail = useCallback(() => {
    if (!directDiagnosisId && listScrollY.current !== null) {
      shouldRestoreListScroll.current = true;
    }
    if (
      !directDiagnosisId &&
      isHistoryDetailOpen.current &&
      diagnosisDetailIdFromHistoryState(window.history.state)
    ) {
      isHistoryDetailOpen.current = false;
      openedHistoryDiagnosisId.current = null;
      detail.close();
      window.history.back();
      return;
    }
    isHistoryDetailOpen.current = false;
    openedHistoryDiagnosisId.current = null;
    detail.close();
  }, [detail.close, directDiagnosisId]);

  const deferQuestion = useCallback(
    async (questionId: string) => {
      if (!directDiagnosisId && listScrollY.current !== null) {
        shouldRestoreListScroll.current = true;
      }
      const shouldRemoveDetailHistory =
        !directDiagnosisId &&
        isHistoryDetailOpen.current &&
        diagnosisDetailIdFromHistoryState(window.history.state) !== null;
      await detail.deferQuestion(questionId);
      if (
        shouldRemoveDetailHistory &&
        isHistoryDetailOpen.current &&
        diagnosisDetailIdFromHistoryState(window.history.state)
      ) {
        isHistoryDetailOpen.current = false;
        openedHistoryDiagnosisId.current = null;
        window.history.back();
      }
    },
    [detail.deferQuestion, directDiagnosisId],
  );

  const changeCategoryFilter = useCallback((filter: RelationshipCategoryFilter) => {
    setCategoryFilter(filter);
    const url = new URL(window.location.href);
    if (filter === "all") {
      url.searchParams.delete("category");
    } else {
      url.searchParams.set("category", filter);
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  useLayoutEffect(() => {
    if (detail.state.status !== "idle" || !shouldRestoreListScroll.current) return;
    shouldRestoreListScroll.current = false;
    const scrollY = listScrollY.current ?? 0;
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
    return () => window.cancelAnimationFrame(frame);
  }, [detail.state.status]);

  const syncDetailWithHistory = useCallback(() => {
    if (directDiagnosisId) return;
    const historyDiagnosisId = diagnosisDetailIdFromHistoryState(window.history.state);
    if (!historyDiagnosisId) {
      if (!isHistoryDetailOpen.current) return;
      isHistoryDetailOpen.current = false;
      openedHistoryDiagnosisId.current = null;
      listScrollY.current ??= 0;
      shouldRestoreListScroll.current = true;
      detail.close();
      return;
    }
    if (
      diagnoses.state.status !== "success" ||
      (isHistoryDetailOpen.current && openedHistoryDiagnosisId.current === historyDiagnosisId)
    ) {
      return;
    }
    const diagnosis = diagnoses.state.data.find(({ id }) => id === historyDiagnosisId);
    if (!diagnosis) return;
    listScrollY.current = listScrollY.current === null ? 0 : window.scrollY;
    isHistoryDetailOpen.current = true;
    openedHistoryDiagnosisId.current = historyDiagnosisId;
    void detail.open(diagnosis);
  }, [detail.close, detail.open, diagnoses.state, directDiagnosisId]);

  useEffect(() => {
    syncDetailWithHistory();
    window.addEventListener("popstate", syncDetailWithHistory);
    return () => window.removeEventListener("popstate", syncDetailWithHistory);
  }, [syncDetailWithHistory]);

  useEffect(() => {
    if (
      !directDiagnosisId ||
      diagnoses.state.status !== "success" ||
      openedDirectDiagnosisId.current === directDiagnosisId
    ) {
      return;
    }
    if (!directDiagnosis) return;
    openedDirectDiagnosisId.current = directDiagnosisId;
    void detail.open(directDiagnosis);
  }, [diagnoses.state.status, detail.open, directDiagnosis, directDiagnosisId]);

  let content = (
    <DiagnosisHome
      categoryFilter={categoryFilter}
      diagnoses={diagnoses.state}
      isAnsweredOpen={isAnsweredOpen}
      onAnsweredOpenChange={setIsAnsweredOpen}
      onCategoryFilterChange={changeCategoryFilter}
      onOpenDiagnosis={openDiagnosis}
      onRetry={() => void diagnoses.load()}
      {...(progression.state.status === "success"
        ? { progressionLevel: progression.state.data.level }
        : {})}
    />
  );

  if (isDirectResultPath && diagnoses.state.status === "loading") {
    content = <DiagnosisResultSkeleton />;
  }

  if (isDirectResultPath && diagnoses.state.status === "success" && !directDiagnosis) {
    content = (
      <DiagnosisGuidance
        kind="invalid-link"
        onBack={closeDetail}
        onRetry={() => void diagnoses.load()}
        backHref={directBackHref}
        backLabel={directBackLabel}
      />
    );
  }

  if (detail.state.status === "loading") {
    content =
      detail.state.destination === "result" ? (
        <DiagnosisResultSkeleton />
      ) : detail.state.showIntroduction ? (
        <DiagnosisIntroductionSkeleton />
      ) : (
        <DiagnosisAnswerSkeleton />
      );
  } else if (detail.state.status === "error") {
    content = (
      <DiagnosisGuidance
        kind="load-error"
        onBack={closeDetail}
        {...(directDiagnosis
          ? {
              onRetry: () => void detail.open(directDiagnosis),
              backHref: directBackHref,
              backLabel: directBackLabel,
            }
          : {})}
      />
    );
  } else if (detail.state.status === "success") {
    const detailContent = detail.state.data;
    if (detailContent.type === "result") {
      content = (
        <DiagnosisResultView
          result={detailContent.result}
          onBack={closeDetail}
          progression={progression.state}
          {...(directDiagnosisId
            ? {
                backHref: fromProfile ? "/me" : "/diagnosis",
                backLabel: fromProfile ? "わたしのまとめ" : "診断一覧",
              }
            : {})}
        />
      );
    }
    if (detailContent.type === "answer") {
      content = (
        <DiagnosisDetailScreen
          diagnosis={detailContent.diagnosis}
          initialAnswers={detailContent.initialAnswers}
          onBack={closeDetail}
          onSaveAnswer={detail.saveAnswer}
          onDeferQuestion={deferQuestion}
          onComplete={() => {
            void detail
              .openCompletedResult()
              .then(() => progression.reload({ expectProcessing: true }));
          }}
        />
      );
    }
    if (detailContent.type === "guidance") {
      content = (
        <DiagnosisGuidance
          kind={detailContent.kind}
          onBack={closeDetail}
          {...(directDiagnosisId ? { backHref: directBackHref, backLabel: directBackLabel } : {})}
        />
      );
    }
  }

  return content;
}
