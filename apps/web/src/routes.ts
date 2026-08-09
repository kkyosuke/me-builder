import type { ComponentType } from "react";

type LazyApplicationModule = { default: ComponentType };
export type MainApplicationRoute = "compatibility" | "diagnosis" | "me";

export async function loadAdminApplication(): Promise<LazyApplicationModule> {
  const feature = await import("./feature/admin");
  return { default: feature.AdminApplication };
}

export async function loadDiagnosisApplication(): Promise<LazyApplicationModule> {
  const feature = await import("./feature/diagnosis");
  return { default: feature.DiagnosisApplication };
}

export async function loadCompatibilityApplication(): Promise<LazyApplicationModule> {
  const feature = await import("./feature/compatibility");
  return { default: feature.CompatibilityApplication };
}

export async function loadProfileApplication(): Promise<LazyApplicationModule> {
  const feature = await import("./feature/profile");
  return { default: feature.ProfileApplication };
}

/** タブへ移動する意図が見えた時だけ、遷移先のチャンクを先読みする。 */
export function preloadMainApplication(route: MainApplicationRoute): void {
  const load =
    route === "me"
      ? loadProfileApplication
      : route === "compatibility"
        ? loadCompatibilityApplication
        : loadDiagnosisApplication;
  void load().catch(() => undefined);
}
