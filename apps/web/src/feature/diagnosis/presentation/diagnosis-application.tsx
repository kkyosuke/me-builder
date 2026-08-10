import { useCallback } from "react";
import { config } from "../../../config";
import { useLiffSession } from "../../liff";
import { DiagnosisDetailScreen } from "./components/diagnosis-detail-screen";
import { DiagnosisGuidance } from "./components/diagnosis-guidance";
import { DiagnosisHome } from "./components/diagnosis-home";
import { DiagnosisDetailSkeleton } from "./components/diagnosis-loading-skeleton";
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
  const handleReset = useCallback(async () => {
    detail.close();
    await diagnoses.load();
  }, [detail.close, diagnoses.load]);
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
    content = <DiagnosisDetailSkeleton />;
  } else if (detail.state.status === "error") {
    content = <DiagnosisGuidance kind="load-error" onBack={detail.close} />;
  } else if (detail.state.status === "success") {
    const detailContent = detail.state.data;
    if (detailContent.type === "result") {
      content = <DiagnosisResultView result={detailContent.result} onBack={detail.close} />;
    }
    if (detailContent.type === "answer") {
      content = (
        <DiagnosisDetailScreen
          diagnosis={detailContent.diagnosis}
          initialAnswers={detailContent.initialAnswers}
          onBack={detail.close}
          onSaveAnswer={detail.saveAnswer}
          onDeferQuestion={detail.deferQuestion}
          onComplete={() => void detail.openCompletedResult()}
        />
      );
    }
    if (detailContent.type === "guidance") {
      content = <DiagnosisGuidance kind={detailContent.kind} onBack={detail.close} />;
    }
  }

  return content;
}
