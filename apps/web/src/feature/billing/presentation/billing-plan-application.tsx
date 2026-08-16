import type { BillingInterval, PaidPlanCode } from "@me-builder/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import { getLiffIdToken } from "../../liff/infrastructure/liff-client";
import { useLiffSession } from "../../liff/presentation/liff-session-provider";
import { fetchProfileEntitlement } from "../../profile-settings/infrastructure/entitlement-api";
import type { ProfileEntitlement } from "../../profile-settings/model/entitlement";
import {
  createCheckoutSession,
  createCustomerPortalSession,
  fetchBillingPlanCatalog,
  fetchBillingTrialEligibility,
  verifyCheckoutSessionCompletion,
} from "../infrastructure/billing-api";
import type { BillingPlan } from "../model/billing-plan";
import { waitForSubscriptionProjection } from "../model/checkout-return";
import { BillingPlanScreen } from "./billing-plan-screen";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "操作を完了できませんでした。";
}

export default function BillingPlanApplication({
  onBack,
  onEntitlementChanged,
  navigateToCheckout = (url) => window.location.assign(url),
  projectionPollIntervalMs = 1_500,
}: {
  onBack: () => void;
  onEntitlementChanged?: (entitlement: ProfileEntitlement) => void;
  navigateToCheckout?: (url: string) => void;
  projectionPollIntervalMs?: number;
}) {
  const { acquireIdToken } = useLiffSession();
  const checkoutResult = useMemo(
    () => new URLSearchParams(window.location.search).get("billing"),
    [],
  );
  const checkoutSessionId = useMemo(
    () => new URLSearchParams(window.location.search).get("session_id"),
    [],
  );
  const loadController = useRef<AbortController | null>(null);
  const [plans, setPlans] = useState<AsyncState<readonly BillingPlan[]>>({ status: "loading" });
  const [entitlement, setEntitlement] = useState<AsyncState<ProfileEntitlement>>({
    status: "loading",
  });
  const [checkoutState, setCheckoutState] = useState<AsyncState<string>>({ status: "idle" });
  const [completionMessage, setCompletionMessage] = useState<string | null>(
    checkoutResult === "checkout-cancel" ? "購入手続きをキャンセルしました。" : null,
  );

  const token = useCallback(
    async (signal: AbortSignal) => {
      const value = getLiffIdToken() ?? (await acquireIdToken(signal));
      if (!value) throw new Error("LINEから料金プランを開き直してください。");
      return value;
    },
    [acquireIdToken],
  );

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setPlans({ status: "loading" });
    setEntitlement({ status: "loading" });
    const [catalogResult, tokenResult] = await Promise.allSettled([
      fetchBillingPlanCatalog(config.apiUrl, controller.signal),
      token(controller.signal),
    ]);
    if (controller.signal.aborted) return;

    const publicPlans = catalogResult.status === "fulfilled" ? catalogResult.value : null;
    if (catalogResult.status === "fulfilled") {
      setPlans({
        status: "success",
        data: catalogResult.value.map((plan) => ({ ...plan, trialDays: null })),
      });
    } else {
      setPlans({ status: "error", message: message(catalogResult.reason) });
    }

    if (tokenResult.status === "rejected") {
      setEntitlement({ status: "error", message: message(tokenResult.reason) });
      return;
    }

    const [trialResult, entitlementResult] = await Promise.allSettled([
      fetchBillingTrialEligibility(config.apiUrl, tokenResult.value, controller.signal),
      fetchProfileEntitlement(config.apiUrl, tokenResult.value, controller.signal),
    ]);
    if (controller.signal.aborted) return;

    if (publicPlans && trialResult.status === "fulfilled") {
      setPlans({
        status: "success",
        data: publicPlans.map((plan) => ({
          ...plan,
          trialDays: trialResult.value ? plan.trialDays : null,
        })),
      });
    }
    setEntitlement(
      entitlementResult.status === "fulfilled"
        ? { status: "success", data: entitlementResult.value }
        : { status: "error", message: message(entitlementResult.reason) },
    );
  }, [token]);

  useEffect(() => {
    if (checkoutResult === "checkout-return") return;
    void load();
    return () => loadController.current?.abort();
  }, [checkoutResult, load]);

  useEffect(() => {
    if (checkoutResult !== "checkout-return") return;
    const controller = new AbortController();
    setPlans({ status: "loading" });
    setEntitlement({ status: "loading" });
    void (async () => {
      try {
        if (!checkoutSessionId) {
          throw new Error("購入結果を確認できませんでした。料金プランからやり直してください。");
        }
        const idToken = await token(controller.signal);
        await verifyCheckoutSessionCompletion(
          config.apiUrl,
          idToken,
          checkoutSessionId,
          controller.signal,
        );
        const [catalogResult, trialResult, entitlementResult] = await Promise.allSettled([
          fetchBillingPlanCatalog(config.apiUrl, controller.signal),
          fetchBillingTrialEligibility(config.apiUrl, idToken, controller.signal),
          waitForSubscriptionProjection(
            async (signal) => fetchProfileEntitlement(config.apiUrl, idToken, signal),
            { signal: controller.signal, intervalMs: projectionPollIntervalMs },
          ),
        ]);
        if (controller.signal.aborted) return;
        if (catalogResult.status === "fulfilled") {
          setPlans({
            status: "success",
            data: catalogResult.value.map((plan) => ({
              ...plan,
              trialDays:
                trialResult.status === "fulfilled" && trialResult.value ? plan.trialDays : null,
            })),
          });
        } else {
          setPlans({ status: "error", message: message(catalogResult.reason) });
        }
        if (entitlementResult.status === "rejected") {
          setEntitlement({ status: "error", message: message(entitlementResult.reason) });
          return;
        }
        const nextEntitlement = entitlementResult.value;
        setEntitlement({ status: "success", data: nextEntitlement });
        const planName = {
          free: "Free",
          lite: "Lite",
          full: "Full",
          family: "ファミリーパック",
        }[nextEntitlement.plan];
        setCompletionMessage(`${planName}が利用できるようになりました。`);
        onEntitlementChanged?.(nextEntitlement);
      } catch (error) {
        if (controller.signal.aborted) return;
        const errorMessage = message(error);
        setPlans({ status: "error", message: errorMessage });
        setEntitlement({ status: "error", message: errorMessage });
      }
    })();
    return () => controller.abort();
  }, [checkoutResult, checkoutSessionId, onEntitlementChanged, projectionPollIntervalMs, token]);

  const checkout = async (plan: PaidPlanCode, interval: BillingInterval) => {
    const controller = new AbortController();
    setCheckoutState({ status: "loading" });
    try {
      if (entitlement.status === "success" && entitlement.data.source === "family-seat") {
        throw new Error(
          "ファミリーパックに参加中です。個人契約を購入するには、先にファミリー席から退出してください。",
        );
      }
      const url = await createCheckoutSession(
        config.apiUrl,
        await token(controller.signal),
        { plan, interval },
        controller.signal,
      );
      navigateToCheckout(url);
    } catch (error) {
      setCheckoutState({ status: "error", message: message(error) });
    }
  };

  const manageSubscription = async () => {
    const controller = new AbortController();
    setCheckoutState({ status: "loading" });
    try {
      const url = await createCustomerPortalSession(
        config.apiUrl,
        await token(controller.signal),
        controller.signal,
      );
      navigateToCheckout(url);
    } catch (error) {
      setCheckoutState({ status: "error", message: message(error) });
    }
  };

  return (
    <BillingPlanScreen
      plans={plans}
      entitlement={entitlement}
      checkoutState={checkoutState}
      completionMessage={completionMessage}
      onBack={onBack}
      onCheckout={(plan, interval) => void checkout(plan, interval)}
      onManageSubscription={() => void manageSubscription()}
      onRetry={() => void load()}
    />
  );
}
