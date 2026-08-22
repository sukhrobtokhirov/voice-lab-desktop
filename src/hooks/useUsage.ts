import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./useAuth";

export type DesktopSttUsage = {
  used_seconds: number;
  daily_limit_seconds: number;
  remaining_seconds: number;
};

export interface DesktopPricingPlan {
  code: string;
  name: string;
  priceCents: number | null;
  priceUsd: string | null;
  currency: string;
  billingInterval: string | null;
  billingIntervalCount: number | null;
  dailyMinutes: number | null;
  maxRecordingSeconds: number | null;
}

export interface DesktopEntitlement {
  active: boolean;
  packageCode: string | null;
  packageName: string | null;
  status: string | null;
  dailySeconds: number;
  maxRequestSeconds: number;
  periodStartsAt: string | null;
  periodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface CreditWalletData {
  isUnlimited: boolean | null;
  balanceCredits: string | null;
  reservedCredits: string | null;
  availableCredits: string | null;
  plan: string | null;
  estimatedCredits: string | null;
  chargedCredits: string | null;
  limits: Record<string, unknown>;
  topUpUrl: string | null;
  updatedAt: string | null;
  supportedLanguages: string[];
  autoDetectionSupported: boolean;
  sttUsage: DesktopSttUsage | null;
  planPrice: {
    amount: string;
    currency: string;
    billingInterval: string | null;
  } | null;
  pricingEnabled: boolean | null;
  pricingCurrency: string | null;
  pricingProvider: string | null;
  plans: DesktopPricingPlan[];
  entitlement: DesktopEntitlement | null;
}

interface UseUsageResult extends CreditWalletData {
  status: string;
  isSubscribed: boolean | null;
  isOverLimit: boolean | null;
  isLoading: boolean;
  hasLoaded: boolean;
  hasUsageData: boolean;
  hasSubscriptionData: boolean;
  error: string | null;
  errorCode: string | null;
  errorRequestId: string | null;
  checkoutLoading: boolean;
  billingAvailable: boolean;
  refetch: () => Promise<void>;
  openCheckout: () => Promise<{ success: boolean; error?: string }>;
  openBillingPortal: () => Promise<{ success: boolean; error?: string }>;
}

type CatalogState = {
  enabled: boolean | null;
  currency: string | null;
  provider: string | null;
  plans: DesktopPricingPlan[];
  isLoading: boolean;
  hasLoaded: boolean;
  error: string | null;
  errorCode: string | null;
  requestId: string | null;
};

type SubscriptionState = {
  entitlement: DesktopEntitlement | null;
  isLoading: boolean;
  hasLoaded: boolean;
  error: string | null;
  errorCode: string | null;
  requestId: string | null;
};

const SUPPORTED_LANGUAGES = ["uz", "en", "ru"];
const BILLING_POLL_DELAYS_MS = [1_000, 2_000, 3_000, 5_000, 8_000] as const;

const STATIC_DESKTOP_STT_DATA = {
  isUnlimited: null,
  balanceCredits: null,
  reservedCredits: null,
  availableCredits: null,
  estimatedCredits: null,
  chargedCredits: null,
  topUpUrl: null,
  updatedAt: null,
  supportedLanguages: SUPPORTED_LANGUAGES,
  autoDetectionSupported: false,
  sttUsage: null,
} satisfies Omit<
  CreditWalletData,
  | "plan"
  | "limits"
  | "planPrice"
  | "pricingEnabled"
  | "pricingCurrency"
  | "pricingProvider"
  | "plans"
  | "entitlement"
>;

const EMPTY_CATALOG: CatalogState = {
  enabled: null,
  currency: null,
  provider: null,
  plans: [],
  isLoading: false,
  hasLoaded: false,
  error: null,
  errorCode: null,
  requestId: null,
};

const EMPTY_SUBSCRIPTION: SubscriptionState = {
  entitlement: null,
  isLoading: false,
  hasLoaded: false,
  error: null,
  errorCode: null,
  requestId: null,
};

function isDesktopSttUsage(value: unknown): value is DesktopSttUsage {
  if (!value || typeof value !== "object") return false;
  const usage = value as Partial<DesktopSttUsage>;
  return (
    Number.isFinite(usage.used_seconds) &&
    Number.isFinite(usage.daily_limit_seconds) &&
    Number.isFinite(usage.remaining_seconds)
  );
}

function isDesktopEntitlement(value: unknown): value is DesktopEntitlement {
  if (!value || typeof value !== "object") return false;
  const entitlement = value as Partial<DesktopEntitlement>;
  return (
    typeof entitlement.active === "boolean" &&
    Number.isFinite(entitlement.dailySeconds) &&
    Number.isFinite(entitlement.maxRequestSeconds)
  );
}

function validPlans(value: unknown): DesktopPricingPlan[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (plan): plan is DesktopPricingPlan =>
      Boolean(plan) &&
      typeof plan === "object" &&
      typeof plan.code === "string" &&
      Boolean(plan.code) &&
      typeof plan.name === "string" &&
      Boolean(plan.name)
  );
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export function useUsage(): UseUsageResult | null {
  const { isSignedIn, user } = useAuth();
  const [sttUsage, setSttUsage] = useState<DesktopSttUsage | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogState>(EMPTY_CATALOG);
  const [subscription, setSubscription] = useState<SubscriptionState>(EMPTY_SUBSCRIPTION);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [isWaitingForBillingReturn, setIsWaitingForBillingReturn] = useState(false);
  const [isPollingSubscription, setIsPollingSubscription] = useState(false);
  const pricingRequest = useRef(0);
  const subscriptionRequest = useRef(0);
  const billingPoll = useRef(0);
  const billingReturnArmed = useRef(false);

  const loadPricing = useCallback(async (options: { silent?: boolean } = {}) => {
    const request = ++pricingRequest.current;
    if (!options.silent) {
      setCatalog((current) => ({
        ...current,
        isLoading: true,
        error: null,
        errorCode: null,
        requestId: null,
      }));
    }
    try {
      const result = await window.electronAPI.desktopPricing?.();
      if (pricingRequest.current !== request) return false;
      if (!result?.success) {
        setCatalog((current) => ({
          ...current,
          isLoading: false,
          hasLoaded: true,
          error: result?.error || "Pricing is unavailable.",
          errorCode: result?.code || "PRICING_UNAVAILABLE",
          requestId: result?.requestId || null,
        }));
        return false;
      }
      setCatalog({
        enabled: result.enabled === true,
        currency: result.currency || null,
        provider: result.provider || null,
        plans: result.enabled === true ? validPlans(result.plans) : [],
        isLoading: false,
        hasLoaded: true,
        error: null,
        errorCode: null,
        requestId: result.requestId || null,
      });
      return true;
    } catch (error) {
      if (pricingRequest.current !== request) return false;
      setCatalog((current) => ({
        ...current,
        isLoading: false,
        hasLoaded: true,
        error: error instanceof Error ? error.message : "Pricing is unavailable.",
        errorCode: "PRICING_UNAVAILABLE",
        requestId: null,
      }));
      return false;
    }
  }, []);

  const loadSubscription = useCallback(
    async (options: { silent?: boolean } = {}): Promise<boolean | null> => {
      if (!isSignedIn) return null;
      const request = ++subscriptionRequest.current;
      if (!options.silent) {
        setSubscription((current) => ({
          ...current,
          isLoading: true,
          error: null,
          errorCode: null,
          requestId: null,
        }));
      }
      try {
        const result = await window.electronAPI.desktopSubscription?.();
        if (subscriptionRequest.current !== request) return null;
        if (!result?.success || !isDesktopEntitlement(result.entitlement)) {
          setSubscription((current) => ({
            ...current,
            isLoading: false,
            hasLoaded: true,
            error: result?.error || "Subscription is unavailable.",
            errorCode: result?.code || "SUBSCRIPTION_UNAVAILABLE",
            requestId: result?.requestId || null,
          }));
          return null;
        }
        setSubscription({
          entitlement: result.entitlement,
          isLoading: false,
          hasLoaded: true,
          error: null,
          errorCode: null,
          requestId: result.requestId || null,
        });
        return result.entitlement.active;
      } catch (error) {
        if (subscriptionRequest.current !== request) return null;
        setSubscription((current) => ({
          ...current,
          isLoading: false,
          hasLoaded: true,
          error: error instanceof Error ? error.message : "Subscription is unavailable.",
          errorCode: "SUBSCRIPTION_UNAVAILABLE",
          requestId: null,
        }));
        return null;
      }
    },
    [isSignedIn]
  );

  const refetch = useCallback(async () => {
    setBillingError(null);
    await Promise.all([loadPricing(), loadSubscription()]);
  }, [loadPricing, loadSubscription]);

  const pollSubscription = useCallback(async () => {
    const poll = ++billingPoll.current;
    setIsPollingSubscription(true);
    try {
      for (const delay of BILLING_POLL_DELAYS_MS) {
        await sleep(delay);
        if (billingPoll.current !== poll) return;
        const active = await loadSubscription({ silent: true });
        if (billingPoll.current !== poll || active === true) return;
      }
    } finally {
      if (billingPoll.current === poll) setIsPollingSubscription(false);
    }
  }, [loadSubscription]);

  const openBilling = useCallback(async () => {
    setBillingError(null);
    if (!window.electronAPI.openVoiceLabBilling) {
      const error = "Billing is unavailable.";
      setBillingError(error);
      return { success: false, error };
    }
    if (catalog.enabled === false && subscription.entitlement?.active !== true) {
      const error = "Desktop plans are not available right now.";
      setBillingError(error);
      return { success: false, error };
    }
    try {
      const result = await window.electronAPI.openVoiceLabBilling("dictate");
      if (!result?.success) {
        const error = result?.error || "Billing is unavailable.";
        setBillingError(error);
        return { success: false, error };
      }
      billingReturnArmed.current = true;
      setIsWaitingForBillingReturn(true);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Billing is unavailable.";
      setBillingError(message);
      return { success: false, error: message };
    }
  }, [catalog.enabled, subscription.entitlement?.active]);

  useEffect(() => {
    const refreshAfterBillingReturn = () => {
      if (!billingReturnArmed.current || document.visibilityState === "hidden") return;
      billingReturnArmed.current = false;
      setIsWaitingForBillingReturn(false);
      void pollSubscription();
    };
    window.addEventListener("focus", refreshAfterBillingReturn);
    document.addEventListener("visibilitychange", refreshAfterBillingReturn);
    return () => {
      window.removeEventListener("focus", refreshAfterBillingReturn);
      document.removeEventListener("visibilitychange", refreshAfterBillingReturn);
    };
  }, [pollSubscription]);

  useEffect(() => {
    setSttUsage(null);
    setUpdatedAt(null);
    setCatalog(EMPTY_CATALOG);
    setSubscription(EMPTY_SUBSCRIPTION);
    setBillingError(null);
    billingReturnArmed.current = false;
    setIsWaitingForBillingReturn(false);
    setIsPollingSubscription(false);
    if (isSignedIn) void Promise.all([loadPricing(), loadSubscription()]);
    return () => {
      pricingRequest.current += 1;
      subscriptionRequest.current += 1;
      billingPoll.current += 1;
    };
  }, [isSignedIn, user?.id, loadPricing, loadSubscription]);

  // The synchronous desktop STT response is authoritative for today's usage.
  useEffect(() => {
    const updateFromSttResult = (event: Event) => {
      const detail = (event as CustomEvent<{ usage?: unknown }>).detail;
      if (!isDesktopSttUsage(detail?.usage)) return;
      setSttUsage(detail.usage);
      setUpdatedAt(new Date().toISOString());
    };
    window.addEventListener("usage-changed", updateFromSttResult);
    return () => window.removeEventListener("usage-changed", updateFromSttResult);
  }, []);

  const entitlement = subscription.entitlement;
  const activePlan = useMemo(
    () =>
      entitlement?.active
        ? catalog.plans.find((plan) => plan.code === entitlement.packageCode) || null
        : null,
    [catalog.plans, entitlement]
  );

  if (!isSignedIn) return null;

  const isSubscribed = entitlement ? entitlement.active : null;
  const plan = entitlement?.active
    ? entitlement.packageName || activePlan?.name || entitlement.packageCode
    : null;
  const planPrice = activePlan?.priceUsd
    ? {
        amount: activePlan.priceUsd,
        currency: activePlan.currency,
        billingInterval: activePlan.billingInterval,
      }
    : null;
  const limits: Record<string, unknown> = {
    supported_languages: SUPPORTED_LANGUAGES,
    auto_detection_supported: false,
  };
  if (entitlement) {
    limits.desktop_daily_seconds = entitlement.dailySeconds;
    limits.desktop_max_request_seconds = entitlement.maxRequestSeconds;
  }
  if (sttUsage) limits.desktop_stt_usage = sttUsage;

  return {
    ...STATIC_DESKTOP_STT_DATA,
    updatedAt,
    sttUsage,
    plan,
    planPrice,
    limits,
    pricingEnabled: catalog.enabled,
    pricingCurrency: catalog.currency,
    pricingProvider: catalog.provider,
    plans: catalog.plans,
    entitlement,
    status: entitlement?.active ? entitlement.status || "active" : "inactive",
    isSubscribed,
    isOverLimit: sttUsage ? sttUsage.remaining_seconds <= 0 : null,
    isLoading: catalog.isLoading || subscription.isLoading,
    hasLoaded: catalog.hasLoaded && subscription.hasLoaded,
    hasUsageData: sttUsage !== null,
    hasSubscriptionData: subscription.hasLoaded && entitlement !== null,
    error: billingError || subscription.error || catalog.error,
    errorCode: subscription.errorCode || catalog.errorCode,
    errorRequestId: subscription.requestId || catalog.requestId,
    checkoutLoading: isWaitingForBillingReturn || isPollingSubscription,
    billingAvailable: entitlement?.active === true || catalog.enabled !== false,
    refetch,
    openCheckout: openBilling,
    openBillingPortal: openBilling,
  };
}
