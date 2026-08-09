import { Suspense, lazy, useState } from "react";
import { LoadingState } from "./components/loading-state";
import { RouteErrorBoundary } from "./components/route-error-boundary";
import {
  type AvatarSelection,
  AvatarSettingsScreen,
  ProfileMenuButton,
  ProfileSettingsScreen,
} from "./feature/profile-settings";
import { useColorTheme } from "./feature/theme";
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
  const isDirectProfilePath = pathname === "/profile" || pathname.startsWith("/profile/");
  const isMePath = pathname === "/me" || pathname.startsWith("/me/") || isDirectProfilePath;
  const [profileView, setProfileView] = useState<"closed" | "profile" | "avatar">(
    isDirectProfilePath ? "profile" : "closed",
  );
  const [avatar, setAvatar] = useState<AvatarSelection | null>(null);

  return (
    <>
      {!isAdminPath && profileView === "closed" && (
        <ProfileMenuButton avatar={avatar} onOpen={() => setProfileView("profile")} />
      )}
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
      {profileView === "profile" && (
        <ProfileSettingsScreen
          avatar={avatar}
          theme={colorTheme.theme}
          onBack={() => {
            if (isDirectProfilePath) {
              window.history.replaceState({}, "", "/me");
            }
            setProfileView("closed");
          }}
          onOpenAvatar={() => setProfileView("avatar")}
          onThemeChange={colorTheme.setTheme}
        />
      )}
      {profileView === "avatar" && (
        <AvatarSettingsScreen
          currentAvatar={avatar}
          onBack={() => setProfileView("profile")}
          onSave={(nextAvatar) => {
            setAvatar(nextAvatar);
            setProfileView("profile");
          }}
        />
      )}
    </>
  );
}
