import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LoadingState } from "./components/loading-state";
import { NotFoundScreen } from "./components/not-found-screen";
import { RouteErrorBoundary } from "./components/route-error-boundary";
import { config } from "./config";
import { AccountRecoveryScreen, issueRecoveryCode } from "./feature/account-recovery";
import {
  AuthSessionProvider,
  type SsoIdentityCallbackResult,
  consumeSsoIdentityCallbackResult,
  useAuthSession,
} from "./feature/auth";
import { createCustomerPortalSession } from "./feature/billing";
import { ServiceTermsAcceptanceHistory, ServiceTermsGate } from "./feature/legal";
import { isInLiffClient, openLiffExternalWindow } from "./feature/liff";
import { McpAuthorizationScreen } from "./feature/mcp";
import {
  type AccountProfile,
  type AvatarSelection,
  type MainRoute,
  PROFILE_HISTORY_STATE_KEY,
  PROFILE_RETURN_PATHNAME_STATE_KEY,
  type ProfileEntitlement,
  ProfileMenuButton,
  type ResetDevelopmentAccountDataResult,
  type SsoIdentityStatus,
  type SsoLinkAttemptStatus,
  confirmSsoLinkAttempt,
  deleteAccountAvatar,
  fetchAccountProfile,
  fetchProfileEntitlement,
  fetchSsoIdentityStatus,
  fetchSsoLinkAttemptStatus,
  focusMainRouteHeading,
  historyProfileReturnPathname,
  historyProfileView,
  isDevelopmentEnvironment,
  resetDevelopmentAccountData,
  resolveProfileView,
  saveAccountAvatar,
  startSsoIdentityLink,
  unlinkSsoIdentity,
} from "./feature/profile-settings";
import { useColorTheme, useFontSize } from "./feature/theme";
import { resolveRequestedPathname } from "./infrastructure/requested-pathname";
import type { AsyncState } from "./model/async-state";
import { restoreWindowScroll } from "./model/scroll-restoration";
import { resolveWebApplicationRoute } from "./model/web-application-route";
import {
  getIdleMainApplicationRoutes,
  loadAdminApplication,
  loadAvatarSettingsScreen,
  loadBillingPlanApplication,
  loadCompatibilityApplication,
  loadDevelopmentBrainItemsApplication,
  loadDiagnosisApplication,
  loadFamilySeatApplication,
  loadMainApplication,
  loadMcpManagementScreen,
  loadPersonalDataApplication,
  loadPhotoDiaryScreen,
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
const PersonalDataApplication = lazy(loadPersonalDataApplication);
const FamilySeatApplication = lazy(loadFamilySeatApplication);
const BillingPlanApplication = lazy(loadBillingPlanApplication);
const DevelopmentBrainItemsApplication = lazy(loadDevelopmentBrainItemsApplication);
const McpManagementScreen = lazy(loadMcpManagementScreen);
const PhotoDiaryScreen = lazy(loadPhotoDiaryScreen);

interface MainNavigationGuard {
  hasUnsavedAnswers: () => boolean;
  restore: () => void;
  waitForPendingAnswers: () => Promise<boolean>;
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
  const fontSize = useFontSize();
  const authSession = useAuthSession();
  const [navigation, setNavigation] = useState(() => {
    const requestedPathname = resolveRequestedPathname();
    const requestedRoute = resolveWebApplicationRoute(requestedPathname);
    const profileView = resolveProfileView(requestedPathname, config.environment);
    const pathname = profileView === "closed" ? requestedPathname : "/me";
    return {
      pathname,
      mainPathname: requestedRoute === "admin" ? null : pathname,
      profileView,
    };
  });
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const applicationContentRef = useRef<HTMLDivElement>(null);
  const mainNavigationGuard = useRef<MainNavigationGuard | null>(null);
  const navigationAttempt = useRef(0);
  const shouldRestoreProfileButtonFocus = useRef(false);
  const { pathname, mainPathname, profileView } = navigation;
  const activeRoute = resolveWebApplicationRoute(pathname);
  const mainApplicationRoute = mainPathname
    ? resolveWebApplicationRoute(mainPathname)
    : activeRoute;
  const isAdminPath = activeRoute === "admin";
  const isCompatibilityPath = mainApplicationRoute === "compatibility";
  const isMePath = mainApplicationRoute === "me";
  const isNotFoundPath = activeRoute === "not-found";
  const isProfileOpen = profileView !== "closed";
  const canUseDevelopmentTools =
    isDevelopmentEnvironment(config.environment) &&
    authSession.state.status === "authenticated" &&
    authSession.state.role === "admin";
  const currentMainRoute = isCompatibilityPath ? "compatibility" : isMePath ? "me" : "diagnosis";
  const mainRouteScrollPositions = useRef(new Map<MainRoute, number>());
  const previousMainRoute = useRef<MainRoute | null>(null);
  const [avatar, setAvatar] = useState<AvatarSelection | null>(null);
  const [profileLinePictureUrl, setProfileLinePictureUrl] = useState<string | undefined>();
  const [profileReadState, setProfileReadState] = useState<
    { status: "loading" | "ready" } | { status: "error"; message: string }
  >({ status: "loading" });
  const [profileReloadKey, setProfileReloadKey] = useState(0);
  const [entitlementState, setEntitlementState] = useState<AsyncState<ProfileEntitlement>>({
    status: "loading",
  });
  const [accountDataResetKey, setAccountDataResetKey] = useState(0);
  const [ssoIdentityState, setSsoIdentityState] = useState<AsyncState<SsoIdentityStatus>>({
    status: "loading",
  });
  const [ssoIdentityCallbackResult, setSsoIdentityCallbackResult] = useState<
    SsoIdentityCallbackResult | undefined
  >();
  const [ssoLinkHandoff, setSsoLinkHandoff] = useState<
    | {
        attemptId: string;
        confirmationSecret: string;
        status: SsoLinkAttemptStatus;
      }
    | undefined
  >();
  const linePictureUrl =
    profileReadState.status === "ready"
      ? (profileLinePictureUrl ??
        (authSession.state.status === "authenticated"
          ? authSession.state.profile.pictureUrl
          : undefined))
      : undefined;
  const sessionRevision =
    authSession.state.status === "authenticated" ? authSession.state.revision : 0;
  const sessionRevisionRef = useRef(sessionRevision);
  sessionRevisionRef.current = sessionRevision;
  const previousSessionRevision = useRef<number | null>(null);

  const applyAccountProfile = useCallback((profile: AccountProfile) => {
    setAvatar(uploadedAvatar(profile));
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
      const nextView = resolveProfileView(window.location.pathname, config.environment);
      const returnPathname = historyProfileReturnPathname(window.history.state) ?? "/me";
      const requestedPathname = resolveRequestedPathname();
      const applyNavigation = () => {
        setNavigation((current) => {
          if (nextView !== "closed") {
            return {
              pathname: returnPathname,
              mainPathname: returnPathname,
              profileView: nextView,
            };
          }
          return {
            pathname: requestedPathname,
            mainPathname:
              resolveWebApplicationRoute(requestedPathname) === "admin"
                ? current.mainPathname
                : requestedPathname,
            profileView: "closed",
          };
        });
      };

      const attempt = ++navigationAttempt.current;
      const guard = mainNavigationGuard.current;
      if (!guard?.hasUnsavedAnswers()) {
        applyNavigation();
        return;
      }
      void guard.waitForPendingAnswers().then((saved) => {
        if (attempt !== navigationAttempt.current) return;
        if (!saved) {
          guard.restore();
          return;
        }
        applyNavigation();
      });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const changeMainNavigationGuard = useCallback((guard: MainNavigationGuard | null) => {
    mainNavigationGuard.current = guard;
  }, []);

  useEffect(() => {
    if (profileView !== "closed" || !shouldRestoreProfileButtonFocus.current) return;
    shouldRestoreProfileButtonFocus.current = false;
    profileButtonRef.current?.focus();
  }, [profileView]);

  useEffect(() => {
    const applicationContent = applicationContentRef.current;
    if (!applicationContent) return;
    if (profileView === "closed" && !isAdminPath && !isNotFoundPath) {
      applicationContent.removeAttribute("inert");
    } else {
      applicationContent.setAttribute("inert", "");
    }
  }, [isAdminPath, isNotFoundPath, profileView]);

  useEffect(() => {
    if (isAdminPath || isNotFoundPath) return;

    return scheduleIdlePreloadAfter(
      () => loadMainApplication(currentMainRoute),
      () => {
        for (const route of getIdleMainApplicationRoutes(currentMainRoute)) {
          preloadMainApplication(route);
        }
        preloadProfileSettingsScreen();
      },
    );
  }, [currentMainRoute, isAdminPath, isNotFoundPath]);

  useEffect(() => {
    if (!isProfileOpen) return;
    return scheduleIdlePreloadAfter(loadProfileSettingsScreen, preloadAvatarSettingsScreen);
  }, [isProfileOpen]);

  useEffect(() => {
    if (!isProfileOpen) {
      setSsoIdentityCallbackResult(undefined);
      return;
    }
    if (config.ssoRolloutMode === "disabled" || authSession.state.status !== "authenticated") {
      return;
    }
    const result = consumeSsoIdentityCallbackResult();
    if (result) setSsoIdentityCallbackResult(result);
  }, [authSession.state.status, isProfileOpen]);

  useEffect(() => {
    if (!isProfileOpen || config.ssoRolloutMode === "disabled") return;
    const controller = new AbortController();
    setSsoIdentityState({ status: "loading" });
    void fetchSsoIdentityStatus(config.apiUrl, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSsoIdentityState({ status: "success", data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setSsoIdentityState({ status: "error", message: errorMessage(error) });
        }
      });
    return () => controller.abort();
  }, [isProfileOpen]);

  useEffect(() => {
    if (isAdminPath || isNotFoundPath) return;
    if (authSession.state.status !== "authenticated") return;
    const controller = new AbortController();
    setAvatar(null);
    setProfileLinePictureUrl(undefined);
    setProfileReadState((current) =>
      profileReloadKey === 0 && current.status === "ready" ? current : { status: "loading" },
    );
    setEntitlementState({ status: "loading" });
    void (async () => {
      try {
        applyAccountProfile(await fetchAccountProfile(config.apiUrl, controller.signal));
        try {
          const entitlement = await fetchProfileEntitlement(config.apiUrl, controller.signal);
          if (!controller.signal.aborted) {
            setEntitlementState({ status: "success", data: entitlement });
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            setEntitlementState({ status: "error", message: errorMessage(error) });
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setProfileReadState({ status: "error", message: errorMessage(error) });
      }
    })();

    return () => controller.abort();
  }, [applyAccountProfile, authSession.state, isAdminPath, isNotFoundPath, profileReloadKey]);

  useEffect(() => {
    if (authSession.state.status !== "authenticated") return;
    if (previousSessionRevision.current === null) {
      previousSessionRevision.current = sessionRevision;
      return;
    }
    if (previousSessionRevision.current === sessionRevision) return;
    previousSessionRevision.current = sessionRevision;
    mainRouteScrollPositions.current.clear();
    setAccountDataResetKey((current) => current + 1);
    if (profileView === "closed") return;
    const returnPathname = mainPathname ?? "/diagnosis";
    window.history.replaceState({}, "", returnPathname);
    setNavigation({
      pathname: returnPathname,
      mainPathname: returnPathname,
      profileView: "closed",
    });
  }, [authSession.state.status, mainPathname, profileView, sessionRevision]);

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

  const openPhotoDiary = () => {
    window.history.pushState({ [PROFILE_HISTORY_STATE_KEY]: "photos" }, "", "/profile/photos");
    setNavigation((current) => ({ ...current, profileView: "photos" }));
  };

  const openBrainItems = () => {
    window.history.pushState(
      { [PROFILE_HISTORY_STATE_KEY]: "brain-items" },
      "",
      "/profile/brain-items",
    );
    setNavigation((current) => ({ ...current, profileView: "brain-items" }));
  };

  const openPersonalData = () => {
    window.history.pushState(
      { [PROFILE_HISTORY_STATE_KEY]: "personal-data" },
      "",
      "/profile/personal-data",
    );
    setNavigation((current) => ({ ...current, profileView: "personal-data" }));
  };

  const openFamily = () => {
    window.history.pushState({ [PROFILE_HISTORY_STATE_KEY]: "family" }, "", "/profile/family");
    setNavigation((current) => ({ ...current, profileView: "family" }));
  };

  const openBillingPlans = () => {
    window.history.pushState({ [PROFILE_HISTORY_STATE_KEY]: "billing" }, "", "/profile/billing");
    setNavigation((current) => ({ ...current, profileView: "billing" }));
  };

  const openMcp = () => {
    window.history.pushState({ [PROFILE_HISTORY_STATE_KEY]: "mcp" }, "", "/profile/mcp");
    setNavigation((current) => ({ ...current, profileView: "mcp" }));
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

  const closePhotoDiary = () => {
    if (historyProfileView(window.history.state) === "photos") {
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

  const closePersonalData = () => {
    if (historyProfileView(window.history.state) === "personal-data") {
      setNavigation((current) => ({ ...current, profileView: "profile" }));
      window.history.back();
      return;
    }

    window.history.replaceState({}, "", "/profile");
    setNavigation((current) => ({ ...current, profileView: "profile" }));
  };

  const closeFamily = () => {
    if (historyProfileView(window.history.state) === "family") {
      setNavigation((current) => ({ ...current, profileView: "profile" }));
      window.history.back();
      return;
    }
    window.history.replaceState({}, "", "/profile");
    setNavigation((current) => ({ ...current, profileView: "profile" }));
  };

  const closeBillingPlans = () => {
    if (historyProfileView(window.history.state) === "billing") {
      setNavigation((current) => ({ ...current, profileView: "profile" }));
      window.history.back();
      return;
    }
    window.history.replaceState({}, "", "/profile");
    setNavigation((current) => ({ ...current, profileView: "profile" }));
  };

  const closeMcp = () => {
    if (historyProfileView(window.history.state) === "mcp") {
      setNavigation((current) => ({ ...current, profileView: "profile" }));
      window.history.back();
      return;
    }
    window.history.replaceState({}, "", "/profile");
    setNavigation((current) => ({ ...current, profileView: "profile" }));
  };

  const saveAvatar = async (nextAvatar: AvatarSelection | null) => {
    const requestedRevision = sessionRevisionRef.current;
    const controller = new AbortController();
    const profile = nextAvatar
      ? await saveAccountAvatar(config.apiUrl, nextAvatar, controller.signal)
      : await deleteAccountAvatar(config.apiUrl, controller.signal);
    if (sessionRevisionRef.current !== requestedRevision) {
      throw new Error("本人確認が更新されました。現在のAccountでもう一度お試しください。");
    }
    applyAccountProfile(profile);
    closeAvatar();
  };

  const resetAccountData = async (): Promise<ResetDevelopmentAccountDataResult> => {
    const requestedRevision = sessionRevisionRef.current;
    const controller = new AbortController();
    const result = await resetDevelopmentAccountData(config.apiUrl, controller.signal);
    if (sessionRevisionRef.current !== requestedRevision) {
      throw new Error("本人確認が更新されました。現在のAccountでもう一度お試しください。");
    }
    setAccountDataResetKey((current) => current + 1);
    return result;
  };

  const createRecoveryCode = async () => {
    const requestedRevision = sessionRevisionRef.current;
    const result = await issueRecoveryCode(config.apiUrl);
    if (sessionRevisionRef.current !== requestedRevision) {
      throw new Error("本人確認が更新されました。現在のAccountでもう一度お試しください。");
    }
    return result;
  };

  const openBillingPortal = async (): Promise<void> => {
    const requestedRevision = sessionRevisionRef.current;
    const controller = new AbortController();
    const url = await createCustomerPortalSession(config.apiUrl, controller.signal);
    if (sessionRevisionRef.current !== requestedRevision) {
      throw new Error("本人確認が更新されました。現在のAccountでもう一度お試しください。");
    }
    window.location.assign(url);
  };

  const linkSsoIdentity = async (): Promise<void> => {
    const liffHandoff = isInLiffClient();
    const started = await startSsoIdentityLink(
      config.apiUrl,
      "/profile?sso=linking",
      liffHandoff ? "liff" : "same-browser",
    );
    if (liffHandoff) {
      if (started.flow !== "liff-handoff") {
        throw new Error("Google連携の確認情報を取得できませんでした。");
      }
      setSsoLinkHandoff({
        attemptId: started.attemptId,
        confirmationSecret: started.confirmationSecret,
        status: "waiting",
      });
      if (!openLiffExternalWindow(started.authorizationUrl)) {
        setSsoLinkHandoff(undefined);
        throw new Error("外部ブラウザを開けませんでした。");
      }
      return;
    }
    if (started.flow !== "same-browser") {
      throw new Error("Google連携の認可URLを取得できませんでした。");
    }
    window.location.assign(started.authorizationUrl);
  };

  const refreshSsoLinkHandoff = useCallback(async (): Promise<void> => {
    if (!ssoLinkHandoff) return;
    const attemptId = ssoLinkHandoff.attemptId;
    const status = await fetchSsoLinkAttemptStatus(
      config.apiUrl,
      attemptId,
      ssoLinkHandoff.confirmationSecret,
    );
    setSsoLinkHandoff((current) =>
      current?.attemptId === attemptId ? { ...current, status } : current,
    );
  }, [ssoLinkHandoff]);

  const confirmSsoLinkHandoff = async (): Promise<void> => {
    if (!ssoLinkHandoff || ssoLinkHandoff.status !== "ready") return;
    const status = await confirmSsoLinkAttempt(
      config.apiUrl,
      ssoLinkHandoff.attemptId,
      ssoLinkHandoff.confirmationSecret,
    );
    setSsoLinkHandoff(undefined);
    setSsoIdentityState({ status: "success", data: status });
  };

  useEffect(() => {
    if (!ssoLinkHandoff) return;
    const refresh = () => void refreshSsoLinkHandoff().catch(() => undefined);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshSsoLinkHandoff, ssoLinkHandoff]);

  const disconnectSsoIdentity = async (): Promise<void> => {
    await unlinkSsoIdentity(config.apiUrl);
    setSsoIdentityState({ status: "success", data: { linked: false, canUnlink: false } });
  };

  return (
    <>
      {!isAdminPath && !isNotFoundPath && profileView === "closed" && (
        <ProfileMenuButton
          ref={profileButtonRef}
          avatar={avatar}
          plan={
            entitlementState.status === "success" && entitlementState.data.status !== "safe-default"
              ? entitlementState.data.plan
              : undefined
          }
          linePictureUrl={linePictureUrl}
          onOpen={openProfile}
          onPreload={preloadProfileSettingsScreen}
        />
      )}
      {mainPathname && !isNotFoundPath && (
        <div
          ref={applicationContentRef}
          hidden={isAdminPath}
          aria-hidden={profileView !== "closed" || isAdminPath ? true : undefined}
        >
          <RouteErrorBoundary>
            <Suspense fallback={<LoadingState message="画面を読み込んでいます..." />}>
              {isCompatibilityPath ? (
                <CompatibilityApplication key={`${sessionRevision}:${accountDataResetKey}`} />
              ) : isMePath ? (
                <ProfileApplication key={`${sessionRevision}:${accountDataResetKey}`} />
              ) : (
                <DiagnosisApplication
                  key={`${sessionRevision}:${accountDataResetKey}`}
                  onNavigationGuardChange={changeMainNavigationGuard}
                />
              )}
            </Suspense>
          </RouteErrorBoundary>
        </div>
      )}
      {isAdminPath && (
        <RouteErrorBoundary>
          <Suspense fallback={<LoadingState message="画面を読み込んでいます..." />}>
            <AdminApplication key={sessionRevision} />
          </Suspense>
        </RouteErrorBoundary>
      )}
      {isNotFoundPath && <NotFoundScreen />}
      {isProfileOpen && (
        <RouteErrorBoundary>
          <Suspense
            fallback={
              <LoadingState message="プロフィールを読み込んでいます..." variant="overlay" />
            }
          >
            <ProfileSettingsScreen
              avatar={avatar}
              isAdmin={
                authSession.state.status === "authenticated" && authSession.state.role === "admin"
              }
              isInactive={profileView !== "profile"}
              inactiveFocusTarget={
                profileView === "photos"
                  ? "photos"
                  : profileView === "mcp"
                    ? "mcp"
                    : profileView === "billing"
                      ? "billing"
                      : profileView === "brain-items"
                        ? "brain-items"
                        : "avatar"
              }
              isProfileLoading={profileReadState.status === "loading"}
              profileError={profileReadState.status === "error" ? profileReadState.message : null}
              entitlement={entitlementState}
              linePictureUrl={linePictureUrl}
              theme={colorTheme.theme}
              fontSize={fontSize.fontSize}
              onBack={closeProfile}
              onOpenAdmin={openAdmin}
              onOpenMcp={openMcp}
              onOpenAvatar={openAvatar}
              onOpenPhotoDiary={openPhotoDiary}
              onOpenBillingPortal={openBillingPortal}
              {...(isDevelopmentEnvironment(config.environment)
                ? {
                    onOpenBillingPlans: openBillingPlans,
                    onOpenPersonalData: openPersonalData,
                  }
                : {})}
              onOpenFamily={openFamily}
              canOpenBrainItems={canUseDevelopmentTools}
              onOpenBrainItems={openBrainItems}
              onRetryProfile={() => setProfileReloadKey((current) => current + 1)}
              canResetAccountData={canUseDevelopmentTools}
              onResetAccountData={resetAccountData}
              onThemeChange={colorTheme.setTheme}
              onFontSizeChange={fontSize.setFontSize}
              serviceTermsAcceptanceHistory={<ServiceTermsAcceptanceHistory />}
              onIssueRecoveryCode={createRecoveryCode}
              {...(config.ssoRolloutMode === "disabled"
                ? {}
                : {
                    ssoIdentity: ssoIdentityState,
                    ...(ssoIdentityCallbackResult ? { ssoIdentityCallbackResult } : {}),
                    onLinkSsoIdentity: linkSsoIdentity,
                    ...(ssoLinkHandoff ? { ssoLinkHandoffStatus: ssoLinkHandoff.status } : {}),
                    onRefreshSsoLinkHandoff: refreshSsoLinkHandoff,
                    onConfirmSsoLinkHandoff: confirmSsoLinkHandoff,
                    onUnlinkSsoIdentity: disconnectSsoIdentity,
                  })}
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
      {profileView === "photos" && (
        <RouteErrorBoundary>
          <Suspense
            fallback={<LoadingState message="写真日記を読み込んでいます..." variant="overlay" />}
          >
            <PhotoDiaryScreen onBack={closePhotoDiary} />
          </Suspense>
        </RouteErrorBoundary>
      )}
      {profileView === "brain-items" && canUseDevelopmentTools && (
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
      {profileView === "personal-data" && isDevelopmentEnvironment(config.environment) && (
        <RouteErrorBoundary>
          <Suspense
            fallback={<LoadingState message="入力データを読み込んでいます..." variant="overlay" />}
          >
            <PersonalDataApplication
              onBack={closePersonalData}
              onChanged={() => setAccountDataResetKey((current) => current + 1)}
            />
          </Suspense>
        </RouteErrorBoundary>
      )}
      {profileView === "family" && (
        <RouteErrorBoundary>
          <Suspense
            fallback={
              <LoadingState message="ファミリーパックを読み込んでいます..." variant="overlay" />
            }
          >
            <FamilySeatApplication onBack={closeFamily} />
          </Suspense>
        </RouteErrorBoundary>
      )}
      {profileView === "billing" && (
        <RouteErrorBoundary>
          <Suspense
            fallback={<LoadingState message="料金プランを読み込んでいます..." variant="overlay" />}
          >
            <BillingPlanApplication
              onBack={closeBillingPlans}
              onEntitlementChanged={(next) =>
                setEntitlementState({ status: "success", data: next })
              }
            />
          </Suspense>
        </RouteErrorBoundary>
      )}
      {profileView === "mcp" &&
        authSession.state.status === "authenticated" &&
        authSession.state.role === "admin" && (
          <RouteErrorBoundary>
            <Suspense
              fallback={<LoadingState message="MCP連携を読み込んでいます..." variant="overlay" />}
            >
              <McpManagementScreen onBack={closeMcp} />
            </Suspense>
          </RouteErrorBoundary>
        )}
    </>
  );
}

export function App() {
  const route = resolveWebApplicationRoute(resolveRequestedPathname());
  return (
    <AuthSessionProvider>
      {route === "account-recovery" ? (
        <AccountRecoveryScreen />
      ) : route === "mcp-authorization" ? (
        <ServiceTermsGate>
          <McpAuthorizationScreen />
        </ServiceTermsGate>
      ) : route === "not-found" ? (
        <NotFoundScreen />
      ) : (
        <ServiceTermsGate>
          <AppContents />
        </ServiceTermsGate>
      )}
    </AuthSessionProvider>
  );
}
