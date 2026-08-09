import { useCallback, useEffect, useRef } from "react";
import { LoadingState } from "../../../components/loading-state";
import { config } from "../../../config";
import { useLiffSession } from "../../liff";
import { DiagnosisDetailScreen } from "./components/diagnosis-detail-screen";
import { DiagnosisGuidance } from "./components/diagnosis-guidance";
import { DiagnosisHome } from "./components/diagnosis-home";
import { DiagnosisResultView } from "./components/diagnosis-result";
import { useDiagnosisDetail } from "./hooks/use-diagnosis-detail";
import { useDiagnosisList } from "./hooks/use-diagnosis-list";
import { useResetDiagnosisData } from "./hooks/use-reset-diagnosis-data";

const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

export default function DiagnosisApplication() {
  const liffSession = useLiffSession();
  const diagnoses = useDiagnosisList({ acquireIdToken: liffSession.acquireIdToken });
  const detail = useDiagnosisDetail({
    idToken: diagnoses.idToken,
    onProgress: diagnoses.updateProgress,
  });
  const searchParams =
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const requestedResultId = searchParams?.get("result")?.trim() || null;
  const resultOpenedFromProfile =
    requestedResultId !== null && searchParams?.get("from") === "profile";
  const profileResultBack = resultOpenedFromProfile
    ? { backHref: "/me", backLabel: "わたしの傾向" }
    : {};
  const openedResultId = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedResultId || !diagnoses.idToken || openedResultId.current === requestedResultId) {
      return;
    }
    openedResultId.current = requestedResultId;
    void detail.openResult(requestedResultId);
  }, [detail.openResult, diagnoses.idToken, requestedResultId]);
  const closeDetail = useCallback(() => {
    detail.close();
    openedResultId.current = null;
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("result")
    ) {
      window.history.replaceState(null, "", "/diagnosis");
    }
  }, [detail.close]);
  const handleReset = useCallback(async () => {
    closeDetail();
    await diagnoses.load();
  }, [closeDetail, diagnoses.load]);
  const reset = useResetDiagnosisData({ idToken: diagnoses.idToken, onReset: handleReset });

  let content = (
    <DiagnosisHome
      diagnoses={diagnoses.state}
      onOpenDiagnosis={(diagnosis) => void detail.open(diagnosis)}
      onRetry={() => void diagnoses.load()}
      canResetDiagnosisData={
        config.environment !== undefined && DEVELOPMENT_ENVIRONMENTS.has(config.environment)
      }
      resetState={reset.state}
      onResetDiagnosisData={() => void reset.reset()}
    />
  );

  if (detail.state.status === "loading") {
    content = <LoadingState message="診断を読み込んでいます..." />;
  } else if (detail.state.status === "error") {
    content = (
      <DiagnosisGuidance
        kind="load-error"
        onBack={closeDetail}
        onRetry={() => void detail.retry()}
        {...profileResultBack}
      />
    );
  } else if (detail.state.status === "success") {
    const detailContent = detail.state.data;
    if (detailContent.type === "result") {
      content = (
        <DiagnosisResultView
          result={detailContent.result}
          onBack={closeDetail}
          showProfileSummaryLink={!resultOpenedFromProfile}
          {...profileResultBack}
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
          onDeferQuestion={detail.deferQuestion}
          onComplete={() => void detail.openCompletedResult()}
        />
      );
    }
    if (detailContent.type === "guidance") {
      content = <DiagnosisGuidance kind={detailContent.kind} onBack={closeDetail} />;
    }
  }

  return content;
}
