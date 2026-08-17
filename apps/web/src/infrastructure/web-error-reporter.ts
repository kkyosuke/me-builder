import {
  WEB_CLIENT_ERROR_TYPES,
  WEB_CLIENT_OPERATION_ERROR_CODES,
  WEB_CLIENT_ROUTES,
  type WebClientErrorKind,
  type WebClientErrorReport,
  type WebClientErrorType,
  type WebClientOperation,
  type WebClientOperationErrorCode,
  type WebClientRoute,
} from "@me-builder/shared";
import { config } from "../config";

const WEB_ERROR_PATH = "/api/observability/web-errors";
const DEDUPLICATION_WINDOW_MS = 5 * 60 * 1_000;
const allowedErrorTypes = new Set<string>(WEB_CLIENT_ERROR_TYPES);
const allowedOperationErrorCodes = new Set<string>(WEB_CLIENT_OPERATION_ERROR_CODES);

type ReportInput = Readonly<{
  kind: WebClientErrorKind;
  error?: unknown;
  filename?: string;
  line?: number;
  column?: number;
  operation?: WebClientOperation;
  operationErrorCode?: WebClientOperationErrorCode;
  operationStatus?: number;
  recovered?: boolean;
}>;

export interface WebErrorReporter {
  report(input: ReportInput): void;
}

type BrowserContext = Readonly<{
  origin: string;
  pathname: string;
  online: boolean;
}>;

type ReporterDependencies = Readonly<{
  apiUrl: string | undefined;
  release: string;
  csrfToken: () => string | null;
  fetch: typeof globalThis.fetch;
  now: () => number;
  browserContext: () => BrowserContext;
}>;

type GlobalErrorTarget = Pick<Window, "addEventListener" | "removeEventListener">;

const staticRoutes: ReadonlySet<string> = new Set(
  WEB_CLIENT_ROUTES.filter((route) => route !== "unknown" && !route.includes(":")),
);

/** 実IDやqueryを運用ログへ出さず、登録済みの画面routeだけへ変換する。 */
export function operationalWebRoute(pathname: string): WebClientRoute {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (/^\/diagnosis\/[^/]+\/answers$/.test(normalized)) {
    return "/diagnosis/:diagnosisId/answers";
  }
  if (normalized.startsWith("/compatibility/invitations/")) {
    return "/compatibility/invitations/:relationshipId";
  }
  if (normalized.startsWith("/compatibility/relationships/")) {
    return "/compatibility/relationships/:relationshipId";
  }
  if (normalized.startsWith("/admin/statistics")) return "/admin/statistics";
  if (normalized.startsWith("/admin")) return "/admin";
  if (normalized.startsWith("/profile/brain-items")) return "/profile/brain-items";
  if (normalized.startsWith("/profile/personal-data")) return "/profile/personal-data";
  if (normalized.startsWith("/profile/avatar")) return "/profile/avatar";
  if (normalized.startsWith("/profile/family")) return "/profile/family";
  if (normalized.startsWith("/profile/billing")) return "/profile/billing";
  if (normalized.startsWith("/profile")) return "/profile";
  return staticRoutes.has(normalized as WebClientRoute)
    ? (normalized as WebClientRoute)
    : "unknown";
}

/** 任意のnameを送らず、調査に必要な標準例外分類だけを返す。 */
export function webClientErrorType(error: unknown): WebClientErrorType {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return "DOMException";
  if (error instanceof Error) {
    return allowedErrorTypes.has(error.name) ? (error.name as WebClientErrorType) : "Error";
  }
  return error === undefined ? "Unknown" : "NonError";
}

/** 自OriginのVite bundle名だけを残し、URLや任意pathは破棄する。 */
export function firstPartyScriptFile(
  filename: string | undefined,
  origin: string,
): string | undefined {
  if (!filename) return undefined;
  try {
    const sourceUrl = new URL(filename, origin);
    if (sourceUrl.origin !== origin || !sourceUrl.pathname.startsWith("/assets/")) return undefined;
    const segments = sourceUrl.pathname.split("/");
    const basename = segments[segments.length - 1];
    return basename && /^[A-Za-z0-9_-]+\.(?:js|mjs)$/.test(basename) && basename.length <= 120
      ? basename
      : undefined;
  } catch {
    return undefined;
  }
}

function boundedPosition(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value ?? 0) >= 1 && (value ?? 0) <= 10_000_000
    ? value
    : undefined;
}

type FirstPartyErrorFrame = Readonly<{
  sourceFile: string;
  sourceLine: number;
  sourceColumn: number;
}>;

/** stack自体は送らず、最初に見つかった自Originのbundle位置だけを安全化して返す。 */
export function firstPartyErrorFrame(
  error: unknown,
  origin: string,
): FirstPartyErrorFrame | undefined {
  if (!(error instanceof Error) || typeof error.stack !== "string") return undefined;
  for (const rawLine of error.stack.split("\n").slice(0, 20)) {
    const match = rawLine.trim().match(/(https?:\/\/[^\s()]+):(\d+):(\d+)\)?$/);
    if (!match) continue;
    const sourceFile = firstPartyScriptFile(match[1], origin);
    const sourceLine = boundedPosition(Number(match[2]));
    const sourceColumn = boundedPosition(Number(match[3]));
    if (sourceFile && sourceLine && sourceColumn) {
      return { sourceFile, sourceLine, sourceColumn };
    }
  }
  return undefined;
}

function reportKey(report: WebClientErrorReport): string {
  return [
    report.kind,
    report.route,
    report.release,
    report.errorType,
    report.sourceFile ?? "unknown",
    report.sourceLine ?? 0,
    report.sourceColumn ?? 0,
    report.operation ?? "unknown",
    report.operationErrorCode ?? "unknown",
    report.operationStatus ?? 0,
    report.recovered,
  ].join(":");
}

export function createWebErrorReporter(dependencies: ReporterDependencies): WebErrorReporter {
  const recentlySent = new Map<string, number>();
  const apiUrl = dependencies.apiUrl?.replace(/\/+$/, "");

  return {
    report(input) {
      if (!apiUrl) return;
      let csrfToken: string | null;
      try {
        csrfToken = dependencies.csrfToken();
      } catch {
        return;
      }
      if (!csrfToken) return;
      const browser = dependencies.browserContext();
      const stackFrame = firstPartyErrorFrame(input.error, browser.origin);
      const eventSourceFile = firstPartyScriptFile(input.filename, browser.origin);
      const sourceFile = eventSourceFile ?? stackFrame?.sourceFile;
      const sourceLine = boundedPosition(input.line) ?? stackFrame?.sourceLine;
      const sourceColumn = boundedPosition(input.column) ?? stackFrame?.sourceColumn;
      const payload: WebClientErrorReport = {
        schemaVersion: 1,
        kind: input.kind,
        route: operationalWebRoute(browser.pathname),
        release: dependencies.release,
        errorType: webClientErrorType(input.error),
        ...(sourceFile ? { sourceFile } : {}),
        ...(sourceLine ? { sourceLine } : {}),
        ...(sourceColumn ? { sourceColumn } : {}),
        ...(input.operation ? { operation: input.operation } : {}),
        ...(input.operationErrorCode ? { operationErrorCode: input.operationErrorCode } : {}),
        ...(input.operationStatus ? { operationStatus: input.operationStatus } : {}),
        online: browser.online,
        recovered: input.recovered === true,
      };
      const key = reportKey(payload);
      const now = dependencies.now();
      const lastSentAt = recentlySent.get(key);
      if (lastSentAt !== undefined && now - lastSentAt < DEDUPLICATION_WINDOW_MS) return;
      recentlySent.set(key, now);
      for (const [candidate, sentAt] of recentlySent) {
        if (now - sentAt >= DEDUPLICATION_WINDOW_MS) recentlySent.delete(candidate);
      }

      try {
        void dependencies
          .fetch(`${apiUrl}${WEB_ERROR_PATH}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken,
            },
            body: JSON.stringify(payload),
            credentials: "include",
            keepalive: true,
          })
          .catch(() => undefined);
      } catch {
        // best effortの運用ログ送信で利用者操作を止めない。
      }
    },
  };
}

type WebErrorCsrfTokenProvider = () => string | null;
let webErrorCsrfTokenProvider: WebErrorCsrfTokenProvider = () => null;

/** composition rootから、application sessionのCSRF token取得境界を注入する。 */
export function configureWebErrorCsrfTokenProvider(provider: WebErrorCsrfTokenProvider): void {
  webErrorCsrfTokenProvider = provider;
}

const appRelease = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "development";

const webErrorReporter = createWebErrorReporter({
  apiUrl: config.apiUrl,
  release: appRelease,
  csrfToken: () => webErrorCsrfTokenProvider(),
  fetch: (...args) => globalThis.fetch(...args),
  now: () => Date.now(),
  browserContext: () => ({
    origin: window.location.origin,
    pathname: window.location.pathname,
    online: navigator.onLine,
  }),
});

/** 最上位の未捕捉例外を安全な固定スキーマで送信する。 */
export function installGlobalWebErrorHandlers(
  target: GlobalErrorTarget,
  reporter: WebErrorReporter = webErrorReporter,
): () => void {
  const onError: EventListener = (event) => {
    const errorEvent = event as ErrorEvent;
    reporter.report({
      kind: "unhandled-error",
      error: errorEvent.error,
      filename: errorEvent.filename,
      line: errorEvent.lineno,
      column: errorEvent.colno,
    });
  };
  const onUnhandledRejection: EventListener = (event) => {
    reporter.report({
      kind: "unhandled-rejection",
      error: (event as PromiseRejectionEvent).reason,
    });
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

export function reportRouteRenderError(error: Error, recovered: boolean): void {
  webErrorReporter.report({
    kind: recovered ? "chunk-load-error" : "render-error",
    error,
    recovered,
  });
}

/** UIで捕捉して利用者へ表示した操作エラーも、固定コードだけをWorkers Logsへ送る。 */
export function reportHandledOperationError(operation: WebClientOperation, error: unknown): void {
  const candidate =
    error && typeof error === "object"
      ? (error as { code?: unknown; status?: unknown })
      : undefined;
  const operationErrorCode =
    typeof candidate?.code === "string" && allowedOperationErrorCodes.has(candidate.code)
      ? (candidate.code as WebClientOperationErrorCode)
      : "UNKNOWN_CLIENT_OPERATION_ERROR";
  const operationStatus =
    typeof candidate?.status === "number" &&
    Number.isSafeInteger(candidate.status) &&
    candidate.status >= 400 &&
    candidate.status <= 599
      ? candidate.status
      : undefined;
  webErrorReporter.report({
    kind: "handled-operation-error",
    error,
    operation,
    operationErrorCode,
    ...(operationStatus ? { operationStatus } : {}),
  });
}
