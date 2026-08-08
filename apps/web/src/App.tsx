import { Suspense, lazy } from "react";
import { LoadingState } from "./components/loading-state";
import { RouteErrorBoundary } from "./components/route-error-boundary";
import { ColorThemeToggle, useColorTheme } from "./feature/theme";
import { loadAdminApplication, loadDiagnosisApplication, loadProfileApplication } from "./routes";

const AdminApplication = lazy(loadAdminApplication);
const DiagnosisApplication = lazy(loadDiagnosisApplication);
const ProfileApplication = lazy(loadProfileApplication);

function resolveRequestedPathname(): string {
  if (typeof window === "undefined") {
    return "/diagnosis";
  }
  if (window.location.pathname !== "/") {
    return window.location.pathname;
  }

  const liffState = new URLSearchParams(window.location.search).get("liff.state");
  if (!liffState?.startsWith("/")) {
    return window.location.pathname;
  }
  return liffState.split(/[?#]/, 1)[0] ?? window.location.pathname;
}

export function App() {
  const colorTheme = useColorTheme();
  const pathname = resolveRequestedPathname();
  const isAdminPath = pathname.startsWith("/admin");
  const isMePath = pathname === "/me" || pathname.startsWith("/me/");

  return (
    <>
      <ColorThemeToggle theme={colorTheme.theme} onToggle={colorTheme.toggleTheme} />
      <RouteErrorBoundary>
        <Suspense fallback={<LoadingState message="画面を読み込んでいます..." />}>
          {isAdminPath ? (
            <AdminApplication />
          ) : isMePath ? (
            <ProfileApplication />
          ) : (
            <DiagnosisApplication />
          )}
        </Suspense>
      </RouteErrorBoundary>
    </>
  );
}
