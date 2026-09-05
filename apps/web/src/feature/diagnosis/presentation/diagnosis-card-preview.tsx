import { DatabaseZap, RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";
import type { DiagnosisDefinition } from "../model/diagnosis-definition";
import type { DiagnosisAnswer } from "../model/types";
import { SwipeDiagnosis } from "./components/swipe-diagnosis";

const dummyDiagnosis: DiagnosisDefinition = {
  id: "diagnosis-card-preview",
  title: "行動と大切にしたいこと",
  description: "表裏カードの操作を確認するためのダミー診断です。",
  relationshipCategory: "general",
  questions: [
    {
      diagnosisQuestionId: "preview-holiday-behavior",
      questionId: "preview-holiday-behavior-question",
      questionVersion: 1,
      text: "予定のない休日は、家でゆっくり過ごすことが多い。",
      hint: "最近の休日を思い浮かべてください。",
      left: { choiceId: "no", label: "いいえ" },
      right: { choiceId: "yes", label: "はい" },
    },
    {
      diagnosisQuestionId: "preview-holiday-value",
      questionId: "preview-holiday-value-question",
      questionVersion: 1,
      text: "予定のない休日は、家でゆっくり過ごせることを大切にしたい。",
      backsideOfDiagnosisQuestionId: "preview-holiday-behavior",
      left: { choiceId: "no", label: "いいえ" },
      right: { choiceId: "yes", label: "はい" },
    },
    {
      diagnosisQuestionId: "preview-conversation-behavior",
      questionId: "preview-conversation-behavior-question",
      questionVersion: 1,
      text: "意見が違うとき、まず相手の話を最後まで聞くことが多い。",
      left: { choiceId: "no", label: "いいえ" },
      right: { choiceId: "yes", label: "はい" },
    },
    {
      diagnosisQuestionId: "preview-conversation-value",
      questionId: "preview-conversation-value-question",
      questionVersion: 1,
      text: "意見が違うときも、お互いの考えを尊重することを大切にしたい。",
      backsideOfDiagnosisQuestionId: "preview-conversation-behavior",
      left: { choiceId: "no", label: "いいえ" },
      right: { choiceId: "yes", label: "はい" },
    },
  ],
};

type PreviewOutcome = "answering" | "completed" | "deferred";

function PreviewFinished({
  outcome,
  onRestart,
}: { outcome: PreviewOutcome; onRestart: () => void }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-xl shadow-slate-950/10 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-lg font-bold text-slate-950 dark:text-slate-50">
        {outcome === "completed" ? "ダミー診断を最後まで確認しました" : "回答を中断しました"}
      </p>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        回答はブラウザのメモリだけで扱い、APIやDBには保存していません。
      </p>
      <button
        type="button"
        onClick={onRestart}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-400 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
      >
        <RotateCcw className="size-4" aria-hidden="true" />
        もう一度試す
      </button>
    </section>
  );
}

/** 表裏カードをDBなしで操作するための開発用表示確認画面。 */
export default function DiagnosisCardPreview() {
  const [run, setRun] = useState(0);
  const [outcome, setOutcome] = useState<PreviewOutcome>("answering");

  const restart = useCallback(() => {
    setRun((current) => current + 1);
    setOutcome("answering");
  }, []);
  const keepInMemory = useCallback(
    async (answer: DiagnosisAnswer) => ({ acceptedAt: answer.acceptedAt }),
    [],
  );
  const deferInMemory = useCallback(async () => {
    setOutcome("deferred");
  }, []);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-5 sm:px-8 sm:py-8">
      <div className="mb-5 rounded-2xl border border-emerald-300/40 bg-emerald-300/10 px-4 py-3 text-sm leading-6 text-emerald-900 dark:text-emerald-100">
        <p className="flex items-center gap-2 font-bold">
          <DatabaseZap className="size-4 shrink-0" aria-hidden="true" />
          DBへ保存しない開発用プレビュー
        </p>
        <p className="mt-1">
          下の回答はこの画面内だけで処理します。診断APIへの通信、seed登録、DB更新は行いません。
        </p>
      </div>

      {outcome === "answering" ? (
        <SwipeDiagnosis
          key={run}
          diagnosis={dummyDiagnosis}
          onBack={restart}
          onSaveAnswer={keepInMemory}
          onDeferQuestion={deferInMemory}
          onComplete={() => setOutcome("completed")}
        />
      ) : (
        <PreviewFinished outcome={outcome} onRestart={restart} />
      )}
    </main>
  );
}
