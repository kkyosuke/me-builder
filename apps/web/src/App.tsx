import { useCallback } from "react";
import { LoadingState } from "./components/loading-state";
import { config } from "./config";
import { useLiffSession } from "./feature/liff";
import {
  SurveyDetailScreen,
  SurveyGuidance,
  SurveyHome,
  SurveyResultView,
  useResetSurveyData,
  useSurveyDetail,
  useSurveyList,
} from "./feature/survey";

const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

export function App() {
  const liffSession = useLiffSession();
  const surveys = useSurveyList({ acquireIdToken: liffSession.acquireIdToken });
  const detail = useSurveyDetail({ idToken: surveys.idToken, onProgress: surveys.updateProgress });
  const handleReset = useCallback(async () => {
    detail.close();
    await surveys.load();
  }, [detail.close, surveys.load]);
  const reset = useResetSurveyData({ idToken: surveys.idToken, onReset: handleReset });

  if (detail.state.status === "loading") {
    return <LoadingState message="アンケートを読み込んでいます..." />;
  }
  if (detail.state.status === "error") {
    return <SurveyGuidance kind="load-error" onBack={detail.close} />;
  }
  if (detail.state.status === "success") {
    const content = detail.state.data;
    if (content.type === "result") {
      return <SurveyResultView result={content.result} onBack={detail.close} />;
    }
    if (content.type === "answer") {
      return (
        <SurveyDetailScreen
          survey={content.survey}
          initialAnswers={content.initialAnswers}
          onBack={detail.close}
          onSaveAnswer={detail.saveAnswer}
          onComplete={() => void detail.openCompletedResult()}
        />
      );
    }
    return <SurveyGuidance kind={content.kind} onBack={detail.close} />;
  }

  return (
    <SurveyHome
      surveys={surveys.state}
      onOpenSurvey={(survey) => void detail.open(survey)}
      onRetry={() => void surveys.load()}
      canResetSurveyData={
        config.environment !== undefined && DEVELOPMENT_ENVIRONMENTS.has(config.environment)
      }
      resetState={reset.state}
      onResetSurveyData={() => void reset.reset()}
    />
  );
}
