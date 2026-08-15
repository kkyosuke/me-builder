import type { CompatibilityRoute } from "../model/compatibility-route";

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

export const loadCompatibilityInvitationApplication = memoizeModuleLoader(
  () => import("./compatibility-invitation-application"),
);
export const loadCompatibilityListApplication = memoizeModuleLoader(
  () => import("./compatibility-list-application"),
);
export const loadCompatibilityResultApplication = memoizeModuleLoader(
  () => import("./compatibility-result-application"),
);
export const loadCompatibilityShareApplication = memoizeModuleLoader(
  () => import("./compatibility-share-application"),
);

function loadCompatibilityRoute(route: CompatibilityRoute): Promise<unknown> {
  if (route === "invitation") return loadCompatibilityInvitationApplication();
  if (route === "result") return loadCompatibilityResultApplication();
  if (route === "share") return loadCompatibilityShareApplication();
  return loadCompatibilityListApplication();
}

export function preloadCompatibilityRoute(route: CompatibilityRoute): void {
  void loadCompatibilityRoute(route).catch(() => undefined);
}
