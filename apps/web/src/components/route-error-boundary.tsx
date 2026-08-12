import { logger } from "@me-builder/shared";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface RouteErrorBoundaryProps {
  children: ReactNode;
  onReload?: () => void;
}

interface RouteErrorBoundaryState {
  failed: boolean;
}

const CHUNK_RELOAD_QUERY = "app-reload";
const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "development";
const chunkLoadFailurePattern =
  /chunkloaderror|chunk load failed|loading chunk .+ failed|failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i;

type ChunkReloadDependencies = Readonly<{
  appVersion: string;
  currentUrl: string;
  replace: (url: string) => void;
  storage: Pick<Storage, "getItem" | "setItem">;
}>;

/** 古いSPAが削除済みlazy chunkを要求した場合だけ、同じリリースにつき1回再取得する。 */
export function recoverFromChunkLoadFailure(
  error: Error,
  { appVersion, currentUrl, replace, storage }: ChunkReloadDependencies,
): boolean {
  if (!chunkLoadFailurePattern.test(`${error.name} ${error.message}`)) return false;
  const recoveryKey = `route-chunk-reload:${appVersion}`;
  try {
    if (storage.getItem(recoveryKey)) return false;
    storage.setItem(recoveryKey, "attempted");
    const reloadUrl = new URL(currentUrl);
    reloadUrl.searchParams.set(CHUNK_RELOAD_QUERY, appVersion);
    replace(reloadUrl.toString());
    return true;
  } catch {
    return false;
  }
}

/** 遅延読み込みの失敗を白画面にせず、アプリ全体の再取得へ案内する。 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error({ err: error, componentStack: info.componentStack }, "画面の描画に失敗しました");
    recoverFromChunkLoadFailure(error, {
      appVersion,
      currentUrl: window.location.href,
      replace: (url) => window.location.replace(url),
      storage: window.sessionStorage,
    });
  }

  private reload = (): void => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl items-center justify-center px-4 py-8 sm:px-8">
        <section className="w-full rounded-3xl border border-amber-400/30 bg-amber-400/10 p-6 text-center">
          <AlertTriangle
            className="mx-auto size-8 text-amber-700 dark:text-amber-300"
            aria-hidden="true"
          />
          <h1 className="mt-4 text-xl font-bold text-slate-950 dark:text-slate-50">
            画面を読み込めませんでした
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            通信状態を確認して、もう一度読み込んでください。
          </p>
          <button
            type="button"
            onClick={this.reload}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-300 px-5 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <RotateCw className="size-4" aria-hidden="true" />
            再読み込み
          </button>
        </section>
      </main>
    );
  }
}
