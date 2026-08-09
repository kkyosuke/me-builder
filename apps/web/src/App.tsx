import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { LoadingState } from "./components/loading-state";
import { RouteErrorBoundary } from "./components/route-error-boundary";
import type { AvatarSelection } from "./feature/profile-settings/model/avatar";
import { ProfileMenuButton } from "./feature/profile-settings/presentation/components/profile-menu-button";
import { useColorTheme } from "./feature/theme";
import {
  loadAdminApplication,
  loadAvatarSettingsScreen,
  loadDiagnosisApplication,
  loadProfileApplication,
  loadProfileSettingsScreen,
  preloadAvatarSettingsScreen,
  preloadMainApplication,
  preloadProfileSettingsScreen,
  scheduleIdlePreloadAfter,
} from "./routes";

const AdminApplication = lazy(loadAdminApplication);
const DiagnosisApplication = lazy(loadDiagnosisApplication);
const ProfileApplication = lazy(loadProfileApplication);
const ProfileSettingsScreen = lazy(loadProfileSettingsScreen);
const AvatarSettingsScreen = lazy(loadAvatarSettingsScreen);

type ProfileView = "closed" | "profile" | "avatar";

const PROFILE_HISTORY_STATE_KEY = "me-builder-profile-view";

function resolveProfileView(pathname: string): ProfileView {
  if (pathname.startsWith("/profile/avatar")) return "avatar";
  if (pathname === "/profile" || pathname.startsWith("/profile/")) return "profile";
  return "closed";
}

function historyProfileView(state: unknown): Exclude<ProfileView, "closed"> | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[PROFILE_HISTORY_STATE_KEY];
  return value === "profile" || value === "avatar" ? value : null;
}

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
  const [navigation, setNavigation] = useState(() => {
    const requestedPathname = resolveRequestedPathname();
    const profileView = resolveProfileView(requestedPathname);
    return {
      pathname: profileView === "closed" ? requestedPathname : "/me",
      profileView,
    };
  });
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const applicationContentRef = useRef<HTMLDivElement>(null);
  const shouldRestoreProfileButtonFocus = useRef(false);
  const { pathname, profileView } = navigation;
  const isAdminPath = pathname.startsWith("/admin");
  const isMePath = pathname === "/me" || pathname.startsWith("/me/");
  const [avatar, setAvatar] = useState<AvatarSelection | null>(null);

  useEffect(() => {
    const handlePopState = () => {
      const nextView = resolveProfileView(window.location.pathname);
      setNavigation((current) => {
        if (nextView !== "closed") {
          return { ...current, profileView: nextView };
        }
        return { pathname: resolveRequestedPathname(), profileView: "closed" };
      });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (profileView !== "closed" || !shouldRestoreProfileButtonFocus.current) return;
    shouldRestoreProfileButtonFocus.current = false;
    profileButtonRef.current?.focus();
  }, [profileView]);

  useEffect(() => {
    const applicationContent = applicationContentRef.current;
    if (!applicationContent) return;
    if (profileView === "closed") {
      applicationContent.removeAttribute("inert");
    } else {
      applicationContent.setAttribute("inert", "");
    }
  }, [profileView]);

  useEffect(() => {
    if (isAdminPath) return;

    return scheduleIdlePreloadAfter(
      isMePath ? loadProfileApplication : loadDiagnosisApplication,
      () => {
        preloadMainApplication(isMePath ? "diagnosis" : "me");
        preloadProfileSettingsScreen();
      },
    );
  }, [isAdminPath, isMePath]);

  useEffect(() => {
    if (profileView !== "profile") return;
    return scheduleIdlePreloadAfter(loadProfileSettingsScreen, preloadAvatarSettingsScreen);
  }, [profileView]);

  const openProfile = () => {
    shouldRestoreProfileButtonFocus.current = true;
    window.history.pushState({ [PROFILE_HISTORY_STATE_KEY]: "profile" }, "", "/profile");
    setNavigation((current) => ({ ...current, profileView: "profile" }));
  };

  const closeProfile = () => {
    if (historyProfileView(window.history.state) === "profile") {
      setNavigation((current) => ({ ...current, profileView: "closed" }));
      window.history.back();
      return;
    }

    window.history.replaceState({}, "", "/me");
    setNavigation({ pathname: "/me", profileView: "closed" });
  };

  const openAvatar = () => {
    window.history.pushState({ [PROFILE_HISTORY_STATE_KEY]: "avatar" }, "", "/profile/avatar");
    setNavigation((current) => ({ ...current, profileView: "avatar" }));
  };

  const closeAvatar = () => {
    if (historyProfileView(window.history.state) === "avatar") {
      setNavigation((current) => ({ ...current, profileView: "profile" }));
      window.history.back();
      return;
    }

    window.history.replaceState({}, "", "/profile");
    setNavigation((current) => ({ ...current, profileView: "profile" }));
  };

  return (
    <>
      {!isAdminPath && profileView === "closed" && (
        <ProfileMenuButton
          ref={profileButtonRef}
          avatar={avatar}
          onOpen={openProfile}
          onPreload={preloadProfileSettingsScreen}
        />
      )}
      <div ref={applicationContentRef} aria-hidden={profileView !== "closed" ? true : undefined}>
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
      </div>
      {profileView === "profile" && (
        <RouteErrorBoundary>
          <Suspense
            fallback={
              <LoadingState message="プロフィールを読み込んでいます..." variant="overlay" />
            }
          >
            <ProfileSettingsScreen
              avatar={avatar}
              theme={colorTheme.theme}
              onBack={closeProfile}
              onOpenAvatar={openAvatar}
              onThemeChange={colorTheme.setTheme}
            />
          </Suspense>
        </RouteErrorBoundary>
      )}
      {profileView === "avatar" && (
        <RouteErrorBoundary>
          <Suspense
            fallback={
              <LoadingState message="アバター設定を読み込んでいます..." variant="overlay" />
            }
          >
            <AvatarSettingsScreen
              currentAvatar={avatar}
              onBack={closeAvatar}
              onSave={(nextAvatar) => {
                setAvatar(nextAvatar);
                closeAvatar();
              }}
            />
          </Suspense>
        </RouteErrorBoundary>
      )}
    </>
  );
}
