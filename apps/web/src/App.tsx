import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { LoadingState } from "./components/loading-state";
import { RouteErrorBoundary } from "./components/route-error-boundary";
import { config } from "./config";
import { LiffSessionProvider, useLiffSession } from "./feature/liff";
import { getLiffIdToken } from "./feature/liff/infrastructure/liff-client";
import { verifyLiffSession } from "./feature/liff/infrastructure/session-api";
import { ProfileMenuButton, useAvatarSettings } from "./feature/profile-settings";
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
  // LIFF SDKが初期化中にliff.stateを実URLへ復元するため、ここでは解釈しない。
  return window.location.pathname;
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
  const previousProfileView = useRef(navigation.profileView);
  const { pathname, profileView } = navigation;
  const isAdminPath = pathname.startsWith("/admin");
  const isCompatibilityPath =
    pathname === "/compatibility" || pathname.startsWith("/compatibility/");
  const isMePath = pathname === "/me" || pathname.startsWith("/me/");
  const currentMainRoute = isCompatibilityPath ? "compatibility" : isMePath ? "me" : "diagnosis";
  const [accountRole, setAccountRole] = useState<"user" | "admin" | null>(null);
  const acquireAvatarIdToken = useCallback(
    (signal: AbortSignal) => {
      const currentIdToken = getLiffIdToken();
      return currentIdToken ? Promise.resolve(currentIdToken) : liffSession.acquireIdToken(signal);
    },
    [liffSession.acquireIdToken],
  );
  const avatarController = useAvatarSettings({
    acquireIdToken: acquireAvatarIdToken,
    enabled: !isAdminPath,
  });
  const linePictureUrl = liffSession.profile?.pictureUrl;
  const avatar =
    avatarController.currentAvatar ??
    (linePictureUrl ? { id: "line-profile", src: linePictureUrl, source: "line" as const } : null);

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
    if (liffSession.isInitializing) return;

    // liff.init() が primary redirect の liff.state を実URLへ復元した後にだけ、
    // そのURLをReact側のナビゲーション状態へ反映する。
    const requestedPathname = resolveRequestedPathname();
    const nextProfileView = resolveProfileView(requestedPathname);
    setNavigation((current) => {
      const nextNavigation = {
        pathname: nextProfileView === "closed" ? requestedPathname : current.pathname,
        profileView: nextProfileView,
      };
      return current.pathname === nextNavigation.pathname &&
        current.profileView === nextNavigation.profileView
        ? current
        : nextNavigation;
    });
  }, [liffSession.isInitializing]);

  useEffect(() => {
    const previousView = previousProfileView.current;
    previousProfileView.current = profileView;
    if (profileView !== "closed" || previousView === "closed") return;
    const animationFrame = window.requestAnimationFrame(() => {
      const profileButton = profileButtonRef.current;
      if (!profileButton) return;
      profileButton.focus();
    });
    return () => window.cancelAnimationFrame(animationFrame);
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
    if (profileView !== "profile") return;
    return scheduleIdlePreloadAfter(loadProfileSettingsScreen, preloadAvatarSettingsScreen);
  }, [profileView]);

  useEffect(() => {
    if (profileView !== "profile") return;

    const controller = new AbortController();
    setAccountRole(null);
    void (async () => {
      try {
        const idToken = getLiffIdToken() ?? (await liffSession.acquireIdToken(controller.signal));
        if (!idToken || controller.signal.aborted) return;
        const session = await verifyLiffSession(config.apiUrl, idToken, controller.signal);
        if (!controller.signal.aborted && session.status === "verified") {
          setAccountRole(session.role);
        }
      } catch {
        // roleを取得できない場合も、管理者導線以外のプロフィール操作は継続する。
      }
    })();

    return () => {
      controller.abort();
      setAccountRole(null);
    };
  }, [liffSession.acquireIdToken, profileView]);

  const openProfile = () => {
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

  if (liffSession.isInitializing) {
    return <LoadingState message="LINEとの接続を準備しています..." />;
  }

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
      {profileView !== "closed" && (
        <RouteErrorBoundary>
          <Suspense
            fallback={
              <LoadingState message="プロフィールを読み込んでいます..." variant="overlay" />
            }
          >
            <ProfileSettingsScreen
              avatar={avatar}
              inactive={profileView === "avatar"}
              isAdmin={accountRole === "admin"}
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
              controller={avatarController}
              onBack={closeAvatar}
              onSaved={closeAvatar}
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
