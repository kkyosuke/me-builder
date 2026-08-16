import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { DevelopmentBrainItems } from "./development-brain-items";
import { useDevelopmentBrainItems } from "./use-development-brain-items";

export default function DevelopmentBrainItemsApplication({ onBack }: { onBack: () => void }) {
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const brainItems = useDevelopmentBrainItems({ enabled: true });

  useEffect(() => {
    backButtonRef.current?.focus();
  }, []);

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="development-brain-items-page-title"
      onCancel={(event) => {
        event.preventDefault();
        onBack();
      }}
      className="fixed inset-0 z-[70] m-0 h-auto max-h-none w-auto max-w-none overflow-y-auto border-0 bg-slate-50 p-0 dark:bg-slate-900"
    >
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
        <div className="mx-auto flex min-h-16 max-w-2xl items-center px-4 sm:px-8">
          <button
            ref={backButtonRef}
            type="button"
            onClick={onBack}
            className="inline-flex size-11 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="プロフィールへ戻る"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
          <h1
            id="development-brain-items-page-title"
            className="ml-2 text-lg font-bold text-slate-950 dark:text-white"
          >
            開発用Brainデータ
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pb-16 sm:px-8">
        <DevelopmentBrainItems
          state={brainItems.state}
          vectorStates={brainItems.vectorStates}
          onRetry={() => void brainItems.reload()}
          onVerifyVector={(brainItemId) => void brainItems.verifyVector(brainItemId)}
        />
      </main>
    </dialog>
  );
}
