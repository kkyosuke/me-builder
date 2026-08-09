import type { ComponentType } from "react";

type LazyApplicationModule = { default: ComponentType };
export type MainApplicationRoute = "diagnosis" | "me";

function memoizeModuleLoader<Module>(load: () => Promise<Module>): () => Promise<Module> {
  let promise: Promise<Module> | undefined;
  return () => {
    if (!promise) {
      promise = load();
      void promise.catch(() => {
        promise = undefined;
      });
    }
    return promise;
  };
}

export const loadAdminApplication = memoizeModuleLoader<LazyApplicationModule>(() =>
  import("./feature/admin").then((feature) => ({
    default: feature.AdminApplication,
  })),
);

export const loadDiagnosisApplication = memoizeModuleLoader<LazyApplicationModule>(() =>
  import("./feature/diagnosis").then((feature) => ({
    default: feature.DiagnosisApplication,
  })),
);

export const loadProfileApplication = memoizeModuleLoader<LazyApplicationModule>(() =>
  import("./feature/profile").then((feature) => ({
    default: feature.ProfileApplication,
  })),
);

export const loadProfileSettingsScreen = memoizeModuleLoader(() =>
  import("./feature/profile-settings/presentation/profile-settings-screen").then((feature) => ({
    default: feature.ProfileSettingsScreen,
  })),
);

export const loadAvatarSettingsScreen = memoizeModuleLoader(() =>
  import("./feature/profile-settings/presentation/avatar-settings-screen").then((feature) => ({
    default: feature.AvatarSettingsScreen,
  })),
);

/** タブへの移動意図を検知した時、遷移先のチャンクをすぐ先読みする。 */
export function preloadMainApplication(route: MainApplicationRoute): void {
  const load = route === "me" ? loadProfileApplication : loadDiagnosisApplication;
  void load().catch(() => undefined);
}

export function preloadProfileSettingsScreen(): void {
  void loadProfileSettingsScreen().catch(() => undefined);
}

export function preloadAvatarSettingsScreen(): void {
  void loadAvatarSettingsScreen().catch(() => undefined);
}

type NavigatorWithConnection = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

function shouldAvoidAutomaticPreload(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as NavigatorWithConnection).connection;
  return connection?.saveData === true || connection?.effectiveType?.includes("2g") === true;
}

/** 初期リソースの読み込みを妨げず、通信に余裕がある時だけ次画面を先読みする。 */
export function scheduleIdlePreload(preload: () => void): () => void {
  if (typeof window === "undefined" || shouldAvoidAutomaticPreload()) return () => undefined;

  const idleWindow = window as unknown as {
    cancelIdleCallback?: Window["cancelIdleCallback"];
    requestIdleCallback?: Window["requestIdleCallback"];
  };
  let idleCallbackId: number | undefined;
  let timeoutId: number | undefined;
  let cancelled = false;

  const run = () => {
    if (!cancelled) preload();
  };
  const schedule = () => {
    if (idleWindow.requestIdleCallback) {
      idleCallbackId = idleWindow.requestIdleCallback(run, { timeout: 2_000 });
      return;
    }
    timeoutId = window.setTimeout(run, 1_000);
  };

  if (document.readyState === "complete") {
    schedule();
  } else {
    window.addEventListener("load", schedule, { once: true });
  }

  return () => {
    cancelled = true;
    window.removeEventListener("load", schedule);
    if (idleCallbackId !== undefined) idleWindow.cancelIdleCallback?.(idleCallbackId);
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  };
}

/** 現在表示するチャンクの取得完了後にだけ、次のチャンクのアイドル先読みを予約する。 */
export function scheduleIdlePreloadAfter(
  loadCurrent: () => Promise<unknown>,
  preload: () => void,
): () => void {
  let cancelled = false;
  let cancelIdlePreload: () => void = () => undefined;

  void loadCurrent()
    .then(() => {
      if (cancelled) return;
      cancelIdlePreload = scheduleIdlePreload(preload);
    })
    .catch(() => undefined);

  return () => {
    cancelled = true;
    cancelIdlePreload();
  };
}
