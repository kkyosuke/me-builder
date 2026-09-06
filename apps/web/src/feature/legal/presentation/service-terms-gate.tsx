import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { WebStartupSkeleton } from "../../../components/web-startup-skeleton";
import { config } from "../../../config";
import {
  resolveRequestedLocation,
  resolveRequestedPathname,
} from "../../../infrastructure/requested-pathname";
import type { WebApplicationRoute } from "../../../model/web-application-route";
import type { ServiceTermsNoticeSummary } from "../../../model/web-startup";
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
  | { status: "document"; revision: number; data: ServiceTermsStatus }
  | { status: "passed"; revision: number; notice: ServiceTermsNoticeSummary | null };

export function ServiceTermsGate({
  children,
  startupRoute = "diagnosis",
}: {
  children: ReactNode;
  startupRoute?: WebApplicationRoute;
}) {
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
  const viewingTerms = resolveRequestedPathname() === "/terms";
  const startupTerms =
    authSession.state.status === "authenticated" ? authSession.state.terms : null;

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
          setState(
            data.acceptance.required || viewingTerms
              ? { status: "document", revision: authenticatedRevision, data }
              : { status: "passed", revision: authenticatedRevision, notice: data.notice },
          );
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
  }, [authenticatedRevision, viewingTerms]);

  useEffect(() => {
    if (authenticatedRevision === null) return;
    if (startupTerms && !startupTerms.acceptance.required && !viewingTerms) {
      requestRef.current?.abort();
      requestRef.current = null;
      setState({
        status: "passed",
        revision: authenticatedRevision,
        notice: startupTerms.notice,
      });
      return;
    }
    loadTerms();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [authenticatedRevision, loadTerms, startupTerms, viewingTerms]);

  const accept = useCallback(async () => {
    if (state.status !== "document") return;
    const submittedRevision = state.revision;
    const destination = serviceTermsAcceptanceDestination(resolveRequestedLocation());
    setSubmitting(true);
    setSubmitError(null);
    try {
      await acceptServiceTerms(config.apiUrl, state.data.document.version);
      if (authenticatedRevisionRef.current !== submittedRevision) return;
      window.history.replaceState({}, "", destination);
      setState({ status: "passed", revision: submittedRevision, notice: state.data.notice });
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
    return <WebStartupSkeleton route={startupRoute} />;
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
    return <WebStartupSkeleton route={startupRoute} />;
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

  if (state.status === "document") {
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
  if (state.notice) {
    return (
      <>
        <ServiceTermsNotice notice={state.notice} />
        {children}
      </>
    );
  }
  return children;
}
