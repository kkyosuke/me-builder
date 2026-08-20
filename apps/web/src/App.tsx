import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LoadingState } from "./components/loading-state";
import { RouteErrorBoundary } from "./components/route-error-boundary";
import { config } from "./config";
import { issueRecoveryCode } from "./feature/account-recovery/infrastructure/account-recovery-api";
import { AccountRecoveryScreen } from "./feature/account-recovery/presentation/account-recovery-screen";
import { AuthSessionProvider, useAuthSession } from "./feature/auth";
import {
  type SsoIdentityCallbackResult,
  consumeSsoIdentityCallbackResult,
} from "./feature/auth/infrastructure/sso-auth-adapter";
import { createCustomerPortalSession } from "./feature/billing/infrastructure/billing-api";
import { ServiceTermsAcceptanceHistory, ServiceTermsGate } from "./feature/legal";
import {
  type ResetDevelopmentAccountDataResult,
  resetDevelopmentAccountData,
} from "./feature/profile-settings/infrastructure/development-account-data-api";
import { fetchProfileEntitlement } from "./feature/profile-settings/infrastructure/entitlement-api";
import {
  type AccountProfile,
  deleteAccountAvatar,
  fetchAccountProfile,
  saveAccountAvatar,
} from "./feature/profile-settings/infrastructure/profile-api";
import {
  type SsoIdentityStatus,
  fetchSsoIdentityStatus,
  startSsoIdentityLink,
  unlinkSsoIdentity,
} from "./feature/profile-settings/infrastructure/sso-identity-api";
import type { AvatarSelection } from "./feature/profile-settings/model/avatar";
import type { ProfileEntitlement } from "./feature/profile-settings/model/entitlement";
import { ProfileMenuButton } from "./feature/profile-settings/presentation/components/profile-menu-button";
import { useColorTheme, useFontSize } from "./feature/theme";
import { resolveRequestedPathname } from "./infrastructure/requested-pathname";
import type { AsyncState } from "./model/async-state";
import { restoreWindowScroll } from "./model/scroll-restoration";
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
  loadPersonalDataApplication,
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

type ProfileView =
  | "closed"
  | "profile"
  | "avatar"
  | "personal-data"
  | "brain-items"
  | "family"
  | "billing";
type MainRoute = "compatibility" | "diagnosis" | "me";

const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

const PROFILE_HISTORY_STATE_KEY = "me-builder-profile-view";
const PROFILE_RETURN_PATHNAME_STATE_KEY = "me-builder-profile-return-pathname";

function resolveProfileView(pathname: string): ProfileView {
  if (pathname.startsWith("/profile/billing")) return "billing";
  if (pathname.startsWith("/profile/family")) return "family";
  if (pathname.startsWith("/profile/avatar")) return "avatar";
  if (pathname.startsWith("/profile/personal-data")) return "personal-data";
  if (pathname.startsWith("/profile/brain-items")) {
    return DEVELOPMENT_ENVIRONMENTS.has(config.environment ?? "") ? "brain-items" : "profile";
  }
  if (pathname === "/profile" || pathname.startsWith("/profile/")) return "profile";
  return "closed";
}

function historyProfileView(state: unknown): Exclude<ProfileView, "closed"> | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[PROFILE_HISTORY_STATE_KEY];
  return value === "profile" ||
    value === "avatar" ||
    value === "personal-data" ||
    value === "brain-items" ||
    value === "family" ||
    value === "billing"
    ? value
    : null;
}

function historyProfileReturnPathname(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[PROFILE_RETURN_PATHNAME_STATE_KEY];
  return typeof value === "string" && value.startsWith("/") ? value : null;
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
  const authSession = useAuthSession();
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
  const canUseDevelopmentTools =
    DEVELOPMENT_ENVIRONMENTS.has(config.environment ?? "") &&
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
    if (isAdminPath) return;
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
  }, [applyAccountProfile, authSession.state, isAdminPath, profileReloadKey]);

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
    const authorizationUrl = await startSsoIdentityLink(config.apiUrl, "/profile?sso=linking");
    window.location.assign(authorizationUrl);
  };

  const disconnectSsoIdentity = async (): Promise<void> => {
    await unlinkSsoIdentity(config.apiUrl);
    setSsoIdentityState({ status: "success", data: { linked: false, canUnlink: false } });
  };

  return (
    <>
      {!isAdminPath && profileView === "closed" && (
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
      {mainPathname && (
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
                <DiagnosisApplication key={`${sessionRevision}:${accountDataResetKey}`} />
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
                profileView === "billing"
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
              onOpenAvatar={openAvatar}
              onOpenBillingPortal={openBillingPortal}
              {...(DEVELOPMENT_ENVIRONMENTS.has(config.environment ?? "")
                ? { onOpenBillingPlans: openBillingPlans }
                : {})}
              onOpenPersonalData={openPersonalData}
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
      {profileView === "personal-data" && (
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
    </>
  );
}

export function App() {
  return (
    <AuthSessionProvider>
      {resolveRequestedPathname() === "/account-recovery" ? (
        <AccountRecoveryScreen />
      ) : (
        <ServiceTermsGate>
          <AppContents />
        </ServiceTermsGate>
      )}
    </AuthSessionProvider>
  );
}
