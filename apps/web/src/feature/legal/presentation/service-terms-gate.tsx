import { type ReactNode, useCallback, useEffect, useState } from "react";
import { LoadingState } from "../../../components/loading-state";
import { config } from "../../../config";
import {
  resolveRequestedLocation,
  resolveRequestedPathname,
} from "../../../infrastructure/requested-pathname";
import { useAuthSession } from "../../auth";
import {
  ServiceTermsVersionConflictError,
  acceptServiceTerms,
  fetchServiceTermsStatus,
} from "../infrastructure/service-terms-api";
import type { ServiceTermsStatus } from "../model/service-terms";
import { serviceTermsAcceptanceDestination } from "../model/service-terms-navigation";
import { ServiceTermsScreen } from "./service-terms-screen";

type GateState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ServiceTermsStatus };

export function ServiceTermsGate({ children }: { children: ReactNode }) {
  const authSession = useAuthSession();
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status !== "loading") return;
    if (authSession.state.status !== "authenticated") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const data = await fetchServiceTermsStatus(config.apiUrl, controller.signal);
        if (!controller.signal.aborted) setState({ status: "ready", data });
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
  }, [authSession.state.status, state.status]);

  const accept = useCallback(async () => {
    if (state.status !== "ready") return;
    const destination = serviceTermsAcceptanceDestination(resolveRequestedLocation());
    setSubmitting(true);
    setSubmitError(null);
    try {
      const acceptance = await acceptServiceTerms(config.apiUrl, state.data.document.version);
      window.history.replaceState({}, "", destination);
      setState({
        ...state,
        data: {
          ...state.data,
          acceptance: {
            required: false,
            acceptedVersion: acceptance.version,
            documentHash: acceptance.documentHash,
            acceptedAt: acceptance.acceptedAt,
          },
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

  if (authSession.state.status === "checking" || authSession.state.status === "redirecting") {
    return <LoadingState message="利用条件を確認しています..." />;
  }
  if (authSession.state.status === "error" || authSession.state.status === "unauthenticated") {
    const message =
      authSession.state.status === "error"
        ? authSession.state.message
        : "本人確認の有効期限が切れました。もう一度お試しください。";
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 text-center">
        <h1 className="text-xl font-bold">本人確認が必要です</h1>
        <p role="alert" className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          {message}
        </p>
        <button
          type="button"
          onClick={() => void authSession.retry()}
          className="mt-6 min-h-11 rounded-xl bg-sky-600 px-5 font-bold text-white"
        >
          再試行
        </button>
      </main>
    );
  }
  if (state.status === "loading") {
    return <LoadingState message="利用条件を確認しています..." />;
  }
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

  const viewingTerms = resolveRequestedPathname() === "/terms";
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
