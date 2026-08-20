import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import type { VoiceLabUser } from "../lib/auth";

export type DesktopSttUsage = {
  used_seconds: number;
  daily_limit_seconds: number;
  remaining_seconds: number;
};

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
  checkoutLoading: boolean;
  refetch: () => Promise<void>;
  openCheckout: () => Promise<{ success: boolean; error?: string }>;
  openBillingPortal: () => Promise<{ success: boolean; error?: string }>;
}

const SUPPORTED_LANGUAGES = ["uz", "en", "ru"];
const MAX_DURATION_SECONDS = 300;

const STATIC_DESKTOP_STT_DATA: CreditWalletData = {
  isUnlimited: null,
  balanceCredits: null,
  reservedCredits: null,
  availableCredits: null,
  plan: null,
  estimatedCredits: null,
  chargedCredits: null,
  limits: {
    supported_languages: SUPPORTED_LANGUAGES,
    auto_detection_supported: false,
    max_duration_seconds: MAX_DURATION_SECONDS,
  },
  topUpUrl: null,
  updatedAt: null,
  supportedLanguages: SUPPORTED_LANGUAGES,
  autoDetectionSupported: false,
  sttUsage: null,
  planPrice: null,
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

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function subscriptionFromUser(user: VoiceLabUser | null): {
  plan: string | null;
  isSubscribed: boolean | null;
  status: string | null;
} {
  if (!user) return { plan: null, isSubscribed: null, status: null };
  const raw = user as Record<string, unknown>;
  const subscription =
    raw.subscription && typeof raw.subscription === "object"
      ? (raw.subscription as Record<string, unknown>)
      : {};
  const plan = firstString(
    raw.plan,
    raw.subscription_plan,
    raw.subscriptionPlan,
    raw.tier,
    subscription.plan,
    subscription.tier
  );
  const status = firstString(
    raw.subscription_status,
    raw.subscriptionStatus,
    subscription.status
  )?.toLowerCase();
  const explicit = raw.is_subscribed ?? raw.isSubscribed ?? subscription.is_active;
  if (typeof explicit === "boolean")
    return { plan, isSubscribed: explicit, status: status || null };
  if (status) {
    return {
      plan,
      isSubscribed: ["active", "trial", "trialing"].includes(status),
      status,
    };
  }
  if (plan)
    return {
      plan,
      isSubscribed: !["free", "none"].includes(plan.toLowerCase()),
      status: null,
    };
  return { plan: null, isSubscribed: null, status: null };
}

type PricingState = {
  plan: string | null;
  planPrice: CreditWalletData["planPrice"];
  isSubscribed: boolean | null;
  status: string | null;
  isLoading: boolean;
  hasLoaded: boolean;
  error: string | null;
  errorCode: string | null;
};

export function useUsage(): UseUsageResult | null {
  const { isSignedIn, user } = useAuth();
  const [data, setData] = useState<CreditWalletData>(STATIC_DESKTOP_STT_DATA);
  const userSubscription = useMemo(() => subscriptionFromUser(user), [user]);
  const pricingRequest = useRef(0);
  const [pricing, setPricing] = useState<PricingState>(() => ({
    ...userSubscription,
    planPrice: null,
    isLoading: false,
    hasLoaded: false,
    error: null,
    errorCode: null,
  }));

  // Usage is account-scoped. Clear it on logout and before another account can
  // render so daily seconds never bleed between desktop sessions.
  useEffect(() => {
    setData(STATIC_DESKTOP_STT_DATA);
  }, [isSignedIn, user?.id]);

  const loadPricing = useCallback(async () => {
    const request = ++pricingRequest.current;
    const fallback = userSubscription;
    if (!isSignedIn) {
      setPricing({
        ...fallback,
        planPrice: null,
        isLoading: false,
        hasLoaded: true,
        error: null,
        errorCode: null,
      });
      return;
    }

    setPricing({
      ...fallback,
      planPrice: null,
      isLoading: true,
      hasLoaded: false,
      error: null,
      errorCode: null,
    });
    try {
      const result = await window.electronAPI.desktopPricing?.();
      if (pricingRequest.current !== request) return;
      if (!result?.success) {
        setPricing({
          ...fallback,
          planPrice: null,
          isLoading: false,
          hasLoaded: true,
          error: result?.error || "Pricing is unavailable.",
          errorCode: result?.code || "PRICING_UNAVAILABLE",
        });
        return;
      }
      setPricing({
        plan: firstString(result.plan?.name, result.plan?.code, fallback.plan),
        planPrice:
          result.plan?.priceUsd && result.plan?.currency
            ? {
                amount: result.plan.priceUsd,
                currency: result.plan.currency,
                billingInterval: result.plan.billingInterval ?? null,
              }
            : null,
        isSubscribed: fallback.isSubscribed,
        status: fallback.status,
        isLoading: false,
        hasLoaded: true,
        error: null,
        errorCode: null,
      });
    } catch (error) {
      if (pricingRequest.current !== request) return;
      setPricing({
        ...fallback,
        planPrice: null,
        isLoading: false,
        hasLoaded: true,
        error: error instanceof Error ? error.message : "Pricing is unavailable.",
        errorCode: "PRICING_UNAVAILABLE",
      });
    }
  }, [isSignedIn, userSubscription]);

  useEffect(() => {
    void loadPricing();
    return () => {
      pricingRequest.current += 1;
    };
  }, [loadPricing]);

  // The synchronous STT response is the only authoritative usage source for
  // this token. Never turn this event into a wallet request.
  useEffect(() => {
    const updateFromSttResult = (event: Event) => {
      const detail = (event as CustomEvent<{ usage?: unknown }>).detail;
      if (!isDesktopSttUsage(detail?.usage)) return;
      const sttUsage = detail.usage;
      setData((current) => ({
        ...current,
        limits: { ...current.limits, desktop_stt_usage: sttUsage },
        sttUsage,
        updatedAt: new Date().toISOString(),
      }));
    };
    window.addEventListener("usage-changed", updateFromSttResult);
    return () => window.removeEventListener("usage-changed", updateFromSttResult);
  }, []);

  const openBilling = useCallback(async () => {
    if (!window.electronAPI.openVoiceLabBilling) {
      return { success: false, error: "Billing is unavailable." };
    }
    return window.electronAPI.openVoiceLabBilling("dictate");
  }, []);

  if (!isSignedIn) return null;

  return {
    ...data,
    plan: pricing.plan,
    planPrice: pricing.planPrice,
    status: pricing.status || "unknown",
    isSubscribed: pricing.isSubscribed,
    isOverLimit: data.sttUsage ? data.sttUsage.remaining_seconds <= 0 : null,
    isLoading: pricing.isLoading,
    hasLoaded: pricing.hasLoaded,
    hasUsageData: data.sttUsage !== null,
    hasSubscriptionData: pricing.plan !== null || pricing.isSubscribed !== null,
    error: pricing.error,
    errorCode: pricing.errorCode,
    checkoutLoading: false,
    refetch: loadPricing,
    openCheckout: openBilling,
    openBillingPortal: openBilling,
  };
}
