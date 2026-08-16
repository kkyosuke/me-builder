import type { BillingInterval, PaidPlanCode } from "@me-builder/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import { getLiffIdToken } from "../../liff/infrastructure/liff-client";
import { useLiffSession } from "../../liff/presentation/liff-session-provider";
import { fetchProfileEntitlement } from "../../profile-settings/infrastructure/entitlement-api";
import type { ProfileEntitlement } from "../../profile-settings/model/entitlement";
import { createCheckoutSession, fetchBillingPlanCatalog } from "../infrastructure/billing-api";
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
    const controller = new AbortController();
    setPlans({ status: "loading" });
    setEntitlement({ status: "loading" });
    try {
      const [nextPlans, nextEntitlement] = await Promise.all([
        fetchBillingPlanCatalog(config.apiUrl, controller.signal),
        token(controller.signal).then((idToken) =>
          fetchProfileEntitlement(config.apiUrl, idToken, controller.signal),
        ),
      ]);
      setPlans({ status: "success", data: nextPlans });
      setEntitlement({ status: "success", data: nextEntitlement });
    } catch (error) {
      const errorMessage = message(error);
      setPlans({ status: "error", message: errorMessage });
      setEntitlement({ status: "error", message: errorMessage });
    }
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (checkoutResult === "checkout-return") return;
    void load();
  }, [checkoutResult, load]);

  useEffect(() => {
    if (checkoutResult !== "checkout-return") return;
    const controller = new AbortController();
    setPlans({ status: "loading" });
    setEntitlement({ status: "loading" });
    void (async () => {
      try {
        const [nextPlans, nextEntitlement] = await Promise.all([
          fetchBillingPlanCatalog(config.apiUrl, controller.signal),
          waitForSubscriptionProjection(
            async (signal) => fetchProfileEntitlement(config.apiUrl, await token(signal), signal),
            { signal: controller.signal, intervalMs: projectionPollIntervalMs },
          ),
        ]);
        setPlans({ status: "success", data: nextPlans });
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
  }, [checkoutResult, onEntitlementChanged, projectionPollIntervalMs, token]);

  const checkout = async (plan: PaidPlanCode, interval: BillingInterval) => {
    const controller = new AbortController();
    setCheckoutState({ status: "loading" });
    try {
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

  return (
    <BillingPlanScreen
      plans={plans}
      entitlement={entitlement}
      checkoutState={checkoutState}
      completionMessage={completionMessage}
      onBack={onBack}
      onCheckout={(plan, interval) => void checkout(plan, interval)}
      onRetry={() => void load()}
    />
  );
}
