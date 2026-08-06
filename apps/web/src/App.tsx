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
import { ColorThemeToggle, useColorTheme } from "./feature/theme";

const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

export function App() {
  const colorTheme = useColorTheme();
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
    content = <LoadingState message="診断を読み込んでいます..." />;
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
          onComplete={() => void detail.openCompletedResult()}
        />
      );
    }
    if (detailContent.type === "guidance") {
      content = <DiagnosisGuidance kind={detailContent.kind} onBack={detail.close} />;
    }
  }

  return (
    <>
      <ColorThemeToggle theme={colorTheme.theme} onToggle={colorTheme.toggleTheme} />
      {content}
    </>
  );
}
