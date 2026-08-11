import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { LoadingState } from "./components/loading-state";
import { RouteErrorBoundary } from "./components/route-error-boundary";
import { config } from "./config";
import { LiffSessionProvider, useLiffSession } from "./feature/liff";
import { getLiffIdToken } from "./feature/liff/infrastructure/liff-client";
import {
  type AccountProfile,
  deleteAccountAvatar,
  fetchAccountProfile,
  saveAccountAvatar,
} from "./feature/profile-settings/infrastructure/profile-api";
import type { AvatarSelection } from "./feature/profile-settings/model/avatar";
import { ProfileMenuButton } from "./feature/profile-settings/presentation/components/profile-menu-button";
import { useColorTheme } from "./feature/theme";
import {
  getIdleMainApplicationRoutes,
  loadAdminApplication,
  loadAvatarSettingsScreen,
  loadCompatibilityApplication,
  loadDiagnosisApplication,
  loadMainApplication,
  loadProfileApplication,
  loadProfileSettingsScreen,
  preloadAvatarSettingsScreen,
  preloadMainApplication,
  preloadProfileSettingsScreen,
  scheduleIdlePreloadAfter,
} from "./routes";

const AdminApplication = lazy(loadAdminApplication);
const CompatibilityApplication = lazy(loadCompatibilityApplication);
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

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "プロフィールを取得できませんでした。再試行してください。";
}

function uploadedAvatar(profile: AccountProfile): AvatarSelection | null {
  return profile.avatar?.source === "uploaded"
    ? { kind: "uploaded", dataUrl: profile.avatar.url, fileName: "" }
    : null;
}

function AppContents() {
  const colorTheme = useColorTheme();
  const liffSession = useLiffSession();
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
  const isCompatibilityPath =
    pathname === "/compatibility" || pathname.startsWith("/compatibility/");
  const isMePath = pathname === "/me" || pathname.startsWith("/me/");
  const isProfileOpen = profileView !== "closed";
  const currentMainRoute = isCompatibilityPath ? "compatibility" : isMePath ? "me" : "diagnosis";
  const [avatar, setAvatar] = useState<AvatarSelection | null>(null);
  const [accountRole, setAccountRole] = useState<"user" | "admin" | null>(null);
  const [profileLinePictureUrl, setProfileLinePictureUrl] = useState<string | undefined>();
  const [profileReadState, setProfileReadState] = useState<
    { status: "loading" | "ready" } | { status: "error"; message: string }
  >({ status: "loading" });
  const [profileReloadKey, setProfileReloadKey] = useState(0);
  const linePictureUrl = profileLinePictureUrl ?? liffSession.profile?.pictureUrl;

  const applyAccountProfile = useCallback((profile: AccountProfile) => {
    setAvatar(uploadedAvatar(profile));
    setAccountRole(profile.role);
    setProfileLinePictureUrl(profile.avatar?.source === "line" ? profile.avatar.url : undefined);
    setProfileReadState({ status: "ready" });
  }, []);

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
      () => loadMainApplication(currentMainRoute),
      () => {
        for (const route of getIdleMainApplicationRoutes(currentMainRoute)) {
          preloadMainApplication(route);
        }
        preloadProfileSettingsScreen();
      },
    );
  }, [currentMainRoute, isAdminPath]);

  useEffect(() => {
    if (!isProfileOpen) return;
    return scheduleIdlePreloadAfter(loadProfileSettingsScreen, preloadAvatarSettingsScreen);
  }, [isProfileOpen]);

  useEffect(() => {
    if (isAdminPath) return;
    const controller = new AbortController();
    setProfileReadState((current) =>
      profileReloadKey === 0 && current.status === "ready" ? current : { status: "loading" },
    );
    void (async () => {
      try {
        const idToken = getLiffIdToken() ?? (await liffSession.acquireIdToken(controller.signal));
        if (controller.signal.aborted) return;
        if (!idToken) throw new Error("LINEからプロフィールを開き直してください。");
        applyAccountProfile(await fetchAccountProfile(config.apiUrl, idToken, controller.signal));
      } catch (error) {
        if (controller.signal.aborted) return;
        setAccountRole(null);
        setProfileReadState({ status: "error", message: errorMessage(error) });
      }
    })();

    return () => controller.abort();
  }, [applyAccountProfile, isAdminPath, liffSession.acquireIdToken, profileReloadKey]);

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

  const saveAvatar = async (nextAvatar: AvatarSelection | null) => {
    const controller = new AbortController();
    const idToken = getLiffIdToken() ?? (await liffSession.acquireIdToken(controller.signal));
    if (!idToken) throw new Error("LINEからプロフィールを開き直してください。");
    const profile = nextAvatar
      ? await saveAccountAvatar(config.apiUrl, idToken, nextAvatar, controller.signal)
      : await deleteAccountAvatar(config.apiUrl, idToken, controller.signal);
    applyAccountProfile(profile);
    closeAvatar();
  };

  return (
    <>
      {!isAdminPath && profileView === "closed" && (
        <ProfileMenuButton
          ref={profileButtonRef}
          avatar={avatar}
          linePictureUrl={linePictureUrl}
          onOpen={openProfile}
          onPreload={preloadProfileSettingsScreen}
        />
      )}
      <div ref={applicationContentRef} aria-hidden={profileView !== "closed" ? true : undefined}>
        <RouteErrorBoundary>
          <Suspense fallback={<LoadingState message="画面を読み込んでいます..." />}>
            {isAdminPath ? (
              <AdminApplication />
            ) : isCompatibilityPath ? (
              <CompatibilityApplication />
            ) : isMePath ? (
              <ProfileApplication />
            ) : (
              <DiagnosisApplication />
            )}
          </Suspense>
        </RouteErrorBoundary>
      </div>
      {isProfileOpen && (
        <RouteErrorBoundary>
          <Suspense
            fallback={
              <LoadingState message="プロフィールを読み込んでいます..." variant="overlay" />
            }
          >
            <ProfileSettingsScreen
              avatar={avatar}
              isAdmin={accountRole === "admin"}
              isInactive={profileView === "avatar"}
              isProfileLoading={profileReadState.status === "loading"}
              profileError={profileReadState.status === "error" ? profileReadState.message : null}
              linePictureUrl={linePictureUrl}
              theme={colorTheme.theme}
              onBack={closeProfile}
              onOpenAvatar={openAvatar}
              onRetryProfile={() => setProfileReloadKey((current) => current + 1)}
              onThemeChange={colorTheme.setTheme}
            />
          </Suspense>
        </RouteErrorBoundary>
      )}
      {profileView === "avatar" && (
        <RouteErrorBoundary>
          <Suspense
            fallback={
              <LoadingState message="アバター変更を読み込んでいます..." variant="overlay" />
            }
          >
            <AvatarSettingsScreen
              currentAvatar={avatar}
              linePictureUrl={linePictureUrl}
              onBack={closeAvatar}
              onSave={saveAvatar}
            />
          </Suspense>
        </RouteErrorBoundary>
      )}
    </>
  );
}

export function App() {
  return (
    <LiffSessionProvider>
      <AppContents />
    </LiffSessionProvider>
  );
}
