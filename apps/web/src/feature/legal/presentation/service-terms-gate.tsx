import { type ReactNode, useCallback, useEffect, useState } from "react";
import { LoadingState } from "../../../components/loading-state";
import { config } from "../../../config";
import { useLiffSession } from "../../liff";
import {
  ServiceTermsVersionConflictError,
  acceptServiceTerms,
  fetchServiceTermsStatus,
} from "../infrastructure/service-terms-api";
import type { ServiceTermsStatus } from "../model/service-terms";
import { ServiceTermsScreen } from "./service-terms-screen";

type GateState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ServiceTermsStatus; idToken: string };

export function ServiceTermsGate({ children }: { children: ReactNode }) {
  const liffSession = useLiffSession();
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status !== "loading") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const idToken = await liffSession.acquireIdToken(controller.signal);
        if (!idToken) throw new Error("LINEから利用規約を開き直してください。");
        const data = await fetchServiceTermsStatus(config.apiUrl, idToken, controller.signal);
        if (!controller.signal.aborted) setState({ status: "ready", data, idToken });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "利用規約を確認できませんでした。",
          });
        }
      }
    })();
    return () => controller.abort();
  }, [liffSession.acquireIdToken, state.status]);

  const accept = useCallback(async () => {
    if (state.status !== "ready") return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const acceptedAt = await acceptServiceTerms(
        config.apiUrl,
        state.idToken,
        state.data.document.version,
      );
      setState({
        ...state,
        data: {
          ...state.data,
          acceptance: { required: false, acceptedAt },
        },
      });
    } catch (error) {
      if (error instanceof ServiceTermsVersionConflictError) {
        setState({ status: "loading" });
        return;
      }
      setSubmitError(error instanceof Error ? error.message : "同意を記録できませんでした。");
    } finally {
      setSubmitting(false);
    }
  }, [state]);

  if (state.status === "loading") return <LoadingState message="利用条件を確認しています..." />;
  if (state.status === "error") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 text-center">
        <h1 className="text-xl font-bold">利用規約を確認できませんでした</h1>
        <p role="alert" className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          {state.message}
        </p>
        <button
          type="button"
          onClick={() => setState({ status: "loading" })}
          className="mt-6 min-h-11 rounded-xl bg-sky-600 px-5 font-bold text-white"
        >
          再試行
        </button>
      </main>
    );
  }

  const viewingTerms = window.location.pathname === "/terms";
  if (state.data.acceptance.required || viewingTerms) {
    return (
      <ServiceTermsScreen
        status={state.data}
        submitting={submitting}
        error={submitError}
        {...(state.data.acceptance.required ? { onAccept: () => void accept() } : {})}
        {...(viewingTerms && !state.data.acceptance.required
          ? { onBack: () => window.history.back() }
          : {})}
      />
    );
  }
  return children;
}
