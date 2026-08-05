import { useCallback } from "react";
import { LoadingState } from "./components/loading-state";
import { config } from "./config";
import {
  DiagnosisDetailScreen,
  DiagnosisGuidance,
  DiagnosisHome,
  DiagnosisResultView,
  useDiagnosisDetail,
  useDiagnosisList,
  useResetDiagnosisData,
} from "./feature/diagnosis";
import { useLiffSession } from "./feature/liff";

const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

export function App() {
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

  if (detail.state.status === "loading") {
    return <LoadingState message="診断を読み込んでいます..." />;
  }
  if (detail.state.status === "error") {
    return <DiagnosisGuidance kind="load-error" onBack={detail.close} />;
  }
  if (detail.state.status === "success") {
    const content = detail.state.data;
    if (content.type === "result") {
      return <DiagnosisResultView result={content.result} onBack={detail.close} />;
    }
    if (content.type === "answer") {
      return (
        <DiagnosisDetailScreen
          diagnosis={content.diagnosis}
          initialAnswers={content.initialAnswers}
          onBack={detail.close}
          onSaveAnswer={detail.saveAnswer}
          onComplete={() => void detail.openCompletedResult()}
        />
      );
    }
    return <DiagnosisGuidance kind={content.kind} onBack={detail.close} />;
  }

  return (
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
}
