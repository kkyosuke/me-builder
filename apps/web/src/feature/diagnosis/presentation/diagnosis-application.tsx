import { useEffect, useRef } from "react";
import { useLiffSession } from "../../liff";
import {
  diagnosisResultIdFromPathname,
  isDiagnosisResultPathname,
} from "../model/diagnosis-navigation";
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
  const liffSession = useLiffSession();
  const diagnoses = useDiagnosisList({ acquireIdToken: liffSession.acquireIdToken });
  const detail = useDiagnosisDetail({
    idToken: diagnoses.idToken,
    onProgress: diagnoses.updateProgress,
  });
  const openedDirectDiagnosisId = useRef<string | null>(null);
  const isDirectResultPath = isDiagnosisResultPathname(window.location.pathname);
  const directDiagnosisId = diagnosisResultIdFromPathname(window.location.pathname);
  const fromProfile = new URLSearchParams(window.location.search).get("from") === "me";
  const directBackHref = fromProfile ? "/me" : "/diagnosis";
  const directBackLabel = fromProfile ? "わたしのまとめへ" : "診断一覧へ";
  const directDiagnosis =
    directDiagnosisId && diagnoses.state.status === "success"
      ? diagnoses.state.data.find(({ id }) => id === directDiagnosisId)
      : undefined;

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
      diagnoses={diagnoses.state}
      onOpenDiagnosis={(diagnosis) => void detail.open(diagnosis)}
      onRetry={() => void diagnoses.load()}
    />
  );

  if (isDirectResultPath && diagnoses.state.status === "loading") {
    content = <DiagnosisResultSkeleton />;
  }

  if (isDirectResultPath && diagnoses.state.status === "success" && !directDiagnosis) {
    content = (
      <DiagnosisGuidance
        kind="invalid-link"
        onBack={detail.close}
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
        onBack={detail.close}
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
          onBack={detail.close}
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
          onBack={detail.close}
          onSaveAnswer={detail.saveAnswer}
          onDeferQuestion={detail.deferQuestion}
          onComplete={() => void detail.openCompletedResult()}
        />
      );
    }
    if (detailContent.type === "guidance") {
      content = (
        <DiagnosisGuidance
          kind={detailContent.kind}
          onBack={detail.close}
          {...(directDiagnosisId ? { backHref: directBackHref, backLabel: directBackLabel } : {})}
        />
      );
    }
  }

  return content;
}
