import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
  deleteOwnAccount,
  fetchServiceTermsStatus,
} from "../infrastructure/service-terms-api";
import type { ServiceTermsStatus } from "../model/service-terms";
import { serviceTermsAcceptanceDestination } from "../model/service-terms-navigation";
import { ServiceTermsNotice } from "./service-terms-notice";
import { ServiceTermsScreen } from "./service-terms-screen";

type GateState =
  | { status: "loading"; revision: number | null }
  | { status: "error"; revision: number; message: string }
  | { status: "ready"; revision: number; data: ServiceTermsStatus };

export function ServiceTermsGate({ children }: { children: ReactNode }) {
  const authSession = useAuthSession();
  const authenticatedRevision =
    authSession.state.status === "authenticated" ? authSession.state.revision : null;
  const authenticatedRevisionRef = useRef(authenticatedRevision);
  authenticatedRevisionRef.current = authenticatedRevision;
  const requestRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<GateState>({ status: "loading", revision: null });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [accountDeleted, setAccountDeleted] = useState(false);

  const loadTerms = useCallback(() => {
    if (authenticatedRevision === null) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ status: "loading", revision: authenticatedRevision });
    setSubmitting(false);
    setSubmitError(null);
    void (async () => {
      try {
        const data = await fetchServiceTermsStatus(config.apiUrl, controller.signal);
        if (!controller.signal.aborted) {
          setState({ status: "ready", revision: authenticatedRevision, data });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            revision: authenticatedRevision,
            message: error instanceof Error ? error.message : "利用規約を確認できませんでした。",
          });
        }
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
      }
    })();
  }, [authenticatedRevision]);

  useEffect(() => {
    loadTerms();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [loadTerms]);

  const accept = useCallback(async () => {
    if (state.status !== "ready") return;
    const submittedRevision = state.revision;
    const destination = serviceTermsAcceptanceDestination(resolveRequestedLocation());
    setSubmitting(true);
    setSubmitError(null);
    try {
      const acceptance = await acceptServiceTerms(config.apiUrl, state.data.document.version);
      if (authenticatedRevisionRef.current !== submittedRevision) return;
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
      if (authenticatedRevisionRef.current !== submittedRevision) return;
      if (error instanceof ServiceTermsVersionConflictError) {
        loadTerms();
        return;
      }
      setSubmitError(error instanceof Error ? error.message : "同意を記録できませんでした。");
    } finally {
      setSubmitting(false);
    }
  }, [loadTerms, state]);

  const removeAccount = useCallback(async () => {
    setDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      await deleteOwnAccount(config.apiUrl);
      setAccountDeleted(true);
    } catch (error) {
      setDeleteAccountError(
        error instanceof Error ? error.message : "Accountを削除できませんでした。",
      );
    } finally {
      setDeletingAccount(false);
    }
  }, []);

  if (accountDeleted) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 text-center">
        <h1 className="text-xl font-bold">Accountを削除しました</h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          本人データとログイン情報の削除を受け付けました。この画面を閉じてください。
        </p>
      </main>
    );
  }

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
  if (state.status === "loading" || state.revision !== authenticatedRevision) {
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
          onClick={loadTerms}
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
      <>
        {state.data.notice && <ServiceTermsNotice notice={state.data.notice} />}
        <ServiceTermsScreen
          status={state.data}
          submitting={submitting}
          error={submitError}
          {...(state.data.acceptance.required
            ? {
                onAccept: () => void accept(),
                onDeleteAccount: () => void removeAccount(),
                deletingAccount,
                deleteAccountError,
              }
            : {})}
          {...(viewingTerms && !state.data.acceptance.required
            ? { onBack: () => window.history.back() }
            : {})}
        />
      </>
    );
  }
  if (state.data.notice) {
    return (
      <>
        <ServiceTermsNotice notice={state.data.notice} />
        {children}
      </>
    );
  }
  return children;
}
