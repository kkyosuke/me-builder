import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LoadingState } from "./components/loading-state";
import { RouteErrorBoundary } from "./components/route-error-boundary";
import { config } from "./config";
import { ServiceTermsGate } from "./feature/legal";
import { LiffSessionProvider, useLiffSession } from "./feature/liff";
import { getLiffIdToken } from "./feature/liff/infrastructure/liff-client";
import {
  type ResetDevelopmentAccountDataResult,
  resetDevelopmentAccountData,
} from "./feature/profile-settings/infrastructure/development-account-data-api";
import {
  type AccountProfile,
  deleteAccountAvatar,
  fetchAccountProfile,
  saveAccountAvatar,
} from "./feature/profile-settings/infrastructure/profile-api";
import type { AvatarSelection } from "./feature/profile-settings/model/avatar";
import { ProfileMenuButton } from "./feature/profile-settings/presentation/components/profile-menu-button";
import { useColorTheme, useFontSize } from "./feature/theme";
import {
  getIdleMainApplicationRoutes,
  loadAdminApplication,
  loadAvatarSettingsScreen,
  loadCompatibilityApplication,
  loadDevelopmentBrainItemsApplication,
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
const DevelopmentBrainItemsApplication = lazy(loadDevelopmentBrainItemsApplication);

type ProfileView = "closed" | "profile" | "avatar" | "brain-items";
type MainRoute = "compatibility" | "diagnosis" | "me";

const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

const PROFILE_HISTORY_STATE_KEY = "me-builder-profile-view";
const PROFILE_RETURN_PATHNAME_STATE_KEY = "me-builder-profile-return-pathname";

function resolveProfileView(pathname: string): ProfileView {
  if (pathname.startsWith("/profile/avatar")) return "avatar";
  if (pathname.startsWith("/profile/brain-items")) {
    return DEVELOPMENT_ENVIRONMENTS.has(config.environment ?? "") ? "brain-items" : "profile";
  }
  if (pathname === "/profile" || pathname.startsWith("/profile/")) return "profile";
  return "closed";
}

function historyProfileView(state: unknown): Exclude<ProfileView, "closed"> | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[PROFILE_HISTORY_STATE_KEY];
  return value === "profile" || value === "avatar" || value === "brain-items" ? value : null;
}

function historyProfileReturnPathname(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[PROFILE_RETURN_PATHNAME_STATE_KEY];
  return typeof value === "string" && value.startsWith("/") ? value : null;
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

function restoreWindowScroll(top: number): () => void {
  let animationFrameId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let timeoutId: number | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
    resizeObserver?.disconnect();
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  };
  const apply = () => {
    animationFrameId = null;
    window.scrollTo(0, top);
    if (Math.abs(window.scrollY - top) <= 1) stop();
  };
  const schedule = () => {
    if (stopped || animationFrameId !== null) return;
    animationFrameId = window.requestAnimationFrame(apply);
  };

  apply();
  if (!stopped && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(document.body);
  }
  if (!stopped) timeoutId = window.setTimeout(stop, 5_000);

  return stop;
}

function focusMainRouteHeading(container: HTMLElement, route: MainRoute): () => void {
  let mutationObserver: MutationObserver | null = null;
  let timeoutId: number | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    mutationObserver?.disconnect();
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  };
  const focus = (): boolean => {
    const heading = container.querySelector<HTMLElement>(`[data-main-route-heading="${route}"]`);
    if (!heading) return false;
    heading.focus({ preventScroll: true });
    return true;
  };

  if (focus()) return stop;
  mutationObserver = new MutationObserver(() => {
    if (focus()) stop();
  });
  mutationObserver.observe(container, { childList: true, subtree: true });
  timeoutId = window.setTimeout(stop, 5_000);

  return stop;
}

function AppContents() {
  const colorTheme = useColorTheme();
  const fontSize = useFontSize();
  const liffSession = useLiffSession();
  const [navigation, setNavigation] = useState(() => {
    const requestedPathname = resolveRequestedPathname();
    const profileView = resolveProfileView(requestedPathname);
    const pathname = profileView === "closed" ? requestedPathname : "/me";
    return {
      pathname,
      mainPathname: pathname.startsWith("/admin") ? null : pathname,
      profileView,
    };
  });
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const applicationContentRef = useRef<HTMLDivElement>(null);
  const shouldRestoreProfileButtonFocus = useRef(false);
  const { pathname, mainPathname, profileView } = navigation;
  const isAdminPath = pathname.startsWith("/admin");
  const isCompatibilityPath =
    mainPathname === "/compatibility" || mainPathname?.startsWith("/compatibility/");
  const isMePath = mainPathname === "/me" || mainPathname?.startsWith("/me/");
  const isProfileOpen = profileView !== "closed";
  const currentMainRoute = isCompatibilityPath ? "compatibility" : isMePath ? "me" : "diagnosis";
  const mainRouteScrollPositions = useRef(new Map<MainRoute, number>());
  const previousMainRoute = useRef<MainRoute | null>(null);
  const [avatar, setAvatar] = useState<AvatarSelection | null>(null);
  const [accountRole, setAccountRole] = useState<"user" | "admin" | null>(null);
  const [profileLinePictureUrl, setProfileLinePictureUrl] = useState<string | undefined>();
  const [profileReadState, setProfileReadState] = useState<
    { status: "loading" | "ready" } | { status: "error"; message: string }
  >({ status: "loading" });
  const [profileReloadKey, setProfileReloadKey] = useState(0);
  const [accountDataResetKey, setAccountDataResetKey] = useState(0);
  const linePictureUrl =
    profileReadState.status === "ready"
      ? (profileLinePictureUrl ?? liffSession.profile?.pictureUrl)
      : undefined;

  const applyAccountProfile = useCallback((profile: AccountProfile) => {
    setAvatar(uploadedAvatar(profile));
    setAccountRole(profile.role);
    setProfileLinePictureUrl(profile.avatar?.source === "line" ? profile.avatar.url : undefined);
    setProfileReadState({ status: "ready" });
  }, []);

  useLayoutEffect(() => {
    const previous = previousMainRoute.current;
    if (previous === null) {
      previousMainRoute.current = currentMainRoute;
      return;
    }
    if (previous === currentMainRoute) return;

    mainRouteScrollPositions.current.set(previous, window.scrollY);
    previousMainRoute.current = currentMainRoute;
    const stopScrollRestoration = restoreWindowScroll(
      mainRouteScrollPositions.current.get(currentMainRoute) ?? 0,
    );
    const stopFocusRestoration = applicationContentRef.current
      ? focusMainRouteHeading(applicationContentRef.current, currentMainRoute)
      : () => undefined;
    return () => {
      stopScrollRestoration();
      stopFocusRestoration();
    };
  }, [currentMainRoute]);

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const nextView = resolveProfileView(window.location.pathname);
      setNavigation((current) => {
        if (nextView !== "closed") {
          const returnPathname = historyProfileReturnPathname(window.history.state) ?? "/me";
          return {
            pathname: returnPathname,
            mainPathname: returnPathname,
            profileView: nextView,
          };
        }
        const requestedPathname = resolveRequestedPathname();
        return {
          pathname: requestedPathname,
          mainPathname: requestedPathname.startsWith("/admin")
            ? current.mainPathname
            : requestedPathname,
          profileView: "closed",
        };
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
    if (profileView === "closed" && !isAdminPath) {
      applicationContent.removeAttribute("inert");
    } else {
      applicationContent.setAttribute("inert", "");
    }
  }, [isAdminPath, profileView]);

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
    window.history.pushState(
      {
        [PROFILE_HISTORY_STATE_KEY]: "profile",
        [PROFILE_RETURN_PATHNAME_STATE_KEY]: pathname,
      },
      "",
      "/profile",
    );
    setNavigation((current) => ({ ...current, profileView: "profile" }));
  };

  const openAdmin = () => {
    window.history.pushState({}, "", "/admin");
    setNavigation((current) => ({ ...current, pathname: "/admin", profileView: "closed" }));
  };

  const closeProfile = () => {
    if (historyProfileView(window.history.state) === "profile") {
      setNavigation((current) => ({ ...current, profileView: "closed" }));
      window.history.back();
      return;
    }

    window.history.replaceState({}, "", "/me");
    setNavigation({ pathname: "/me", mainPathname: "/me", profileView: "closed" });
  };

  const openAvatar = () => {
    window.history.pushState({ [PROFILE_HISTORY_STATE_KEY]: "avatar" }, "", "/profile/avatar");
    setNavigation((current) => ({ ...current, profileView: "avatar" }));
  };

  const openBrainItems = () => {
    window.history.pushState(
      { [PROFILE_HISTORY_STATE_KEY]: "brain-items" },
      "",
      "/profile/brain-items",
    );
    setNavigation((current) => ({ ...current, profileView: "brain-items" }));
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

  const closeBrainItems = () => {
    if (historyProfileView(window.history.state) === "brain-items") {
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

  const resetAccountData = async (): Promise<ResetDevelopmentAccountDataResult> => {
    const controller = new AbortController();
    const idToken = getLiffIdToken() ?? (await liffSession.acquireIdToken(controller.signal));
    if (!idToken) throw new Error("LINEからプロフィールを開き直してください。");
    const result = await resetDevelopmentAccountData(config.apiUrl, idToken, controller.signal);
    setAccountDataResetKey((current) => current + 1);
    return result;
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
      {mainPathname && (
        <div
          ref={applicationContentRef}
          hidden={isAdminPath}
          aria-hidden={profileView !== "closed" || isAdminPath ? true : undefined}
        >
          <RouteErrorBoundary>
            <Suspense fallback={<LoadingState message="画面を読み込んでいます..." />}>
              {isCompatibilityPath ? (
                <CompatibilityApplication key={accountDataResetKey} />
              ) : isMePath ? (
                <ProfileApplication key={accountDataResetKey} />
              ) : (
                <DiagnosisApplication key={accountDataResetKey} />
              )}
            </Suspense>
          </RouteErrorBoundary>
        </div>
      )}
      {isAdminPath && (
        <RouteErrorBoundary>
          <Suspense fallback={<LoadingState message="画面を読み込んでいます..." />}>
            <AdminApplication />
          </Suspense>
        </RouteErrorBoundary>
      )}
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
              isInactive={profileView !== "profile"}
              inactiveFocusTarget={profileView === "brain-items" ? "brain-items" : "avatar"}
              isProfileLoading={profileReadState.status === "loading"}
              profileError={profileReadState.status === "error" ? profileReadState.message : null}
              linePictureUrl={linePictureUrl}
              theme={colorTheme.theme}
              fontSize={fontSize.fontSize}
              onBack={closeProfile}
              onOpenAdmin={openAdmin}
              onOpenAvatar={openAvatar}
              canOpenBrainItems={DEVELOPMENT_ENVIRONMENTS.has(config.environment ?? "")}
              onOpenBrainItems={openBrainItems}
              onRetryProfile={() => setProfileReloadKey((current) => current + 1)}
              canResetAccountData={DEVELOPMENT_ENVIRONMENTS.has(config.environment ?? "")}
              onResetAccountData={resetAccountData}
              onThemeChange={colorTheme.setTheme}
              onFontSizeChange={fontSize.setFontSize}
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
      {profileView === "brain-items" && DEVELOPMENT_ENVIRONMENTS.has(config.environment ?? "") && (
        <RouteErrorBoundary>
          <Suspense
            fallback={
              <LoadingState message="Brain Item一覧を読み込んでいます..." variant="overlay" />
            }
          >
            <DevelopmentBrainItemsApplication onBack={closeBrainItems} />
          </Suspense>
        </RouteErrorBoundary>
      )}
    </>
  );
}

export function App() {
  return (
    <LiffSessionProvider>
      <ServiceTermsGate>
        <AppContents />
      </ServiceTermsGate>
    </LiffSessionProvider>
  );
}
