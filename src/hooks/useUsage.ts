import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";

export type DesktopSttUsage = {
  used_seconds: number;
  limit_seconds: number;
  remaining_seconds: number;
  usage_window: "day";
};

export interface DesktopEntitlement {
  active: boolean;
  planId: string | null;
  planName: string | null;
  usageWindow: "day" | null;
  usageLimitSeconds: number;
  usedSeconds: number;
  reservedSeconds: number;
  remainingSeconds: number;
  windowStartsAt: string | null;
  resetsAt: string | null;
}

export interface DesktopUsageData {
  plan: string | null;
  updatedAt: string | null;
  supportedLanguages: string[];
  autoDetectionSupported: boolean;
  sttUsage: DesktopSttUsage | null;
  entitlement: DesktopEntitlement | null;
}

interface UseUsageResult extends DesktopUsageData {
  status: string;
  isSubscribed: boolean | null;
  isOverLimit: boolean | null;
  isLoading: boolean;
  isRefreshing: boolean;
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

type UseUsageOptions = {
  loadOnMount?: boolean;
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
  supportedLanguages: SUPPORTED_LANGUAGES,
  autoDetectionSupported: false,
  sttUsage: null,
} satisfies Omit<DesktopUsageData, "plan" | "updatedAt" | "entitlement">;

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
    Number.isSafeInteger(usage.used_seconds) &&
    Number.isSafeInteger(usage.limit_seconds) &&
    Number.isSafeInteger(usage.remaining_seconds) &&
    usage.used_seconds! >= 0 &&
    usage.limit_seconds! > 0 &&
    usage.remaining_seconds! >= 0 &&
    usage.remaining_seconds! <= usage.limit_seconds! &&
    usage.usage_window === "day"
  );
}

function isDesktopEntitlement(value: unknown): value is DesktopEntitlement {
  if (!value || typeof value !== "object") return false;
  const entitlement = value as Partial<DesktopEntitlement>;
  if (typeof entitlement.active !== "boolean") return false;
  if (!entitlement.active) return true;

  if (
    typeof entitlement.planId !== "string" ||
    !entitlement.planId ||
    typeof entitlement.planName !== "string" ||
    !entitlement.planName ||
    entitlement.usageWindow !== "day" ||
    !Number.isSafeInteger(entitlement.usageLimitSeconds) ||
    !Number.isSafeInteger(entitlement.usedSeconds) ||
    !Number.isSafeInteger(entitlement.reservedSeconds) ||
    !Number.isSafeInteger(entitlement.remainingSeconds) ||
    entitlement.usageLimitSeconds! <= 0 ||
    entitlement.usedSeconds! < 0 ||
    entitlement.reservedSeconds! < 0 ||
    entitlement.remainingSeconds! < 0
  ) {
    return false;
  }

  return (
    entitlement.remainingSeconds ===
    Math.max(
      0,
      entitlement.usageLimitSeconds - entitlement.usedSeconds - entitlement.reservedSeconds
    )
  );
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

type DesktopSubscriptionResponse = {
  success?: boolean;
  entitlement?: unknown;
  error?: string;
  code?: string;
  requestId?: string | null;
};

type DesktopUsageSnapshot = {
  accountKey: string;
  entitlement: DesktopEntitlement;
  requestId: string | null;
  updatedAt: string;
};

const DESKTOP_USAGE_UPDATED_EVENT = "voicelab-desktop-usage-updated";
const subscriptionRequests = new Map<string, Promise<DesktopSubscriptionResponse | undefined>>();

function entitlementUsage(entitlement: DesktopEntitlement): DesktopSttUsage | null {
  if (!entitlement.active) return null;
  return {
    used_seconds: entitlement.usedSeconds,
    limit_seconds: entitlement.usageLimitSeconds,
    remaining_seconds: entitlement.remainingSeconds,
    usage_window: entitlement.usageWindow || "day",
  };
}

function fetchDesktopSubscription(accountKey: string) {
  const pending = subscriptionRequests.get(accountKey);
  if (pending) return pending;

  const request = Promise.resolve(window.electronAPI.desktopSubscription?.())
    .then((result): DesktopSubscriptionResponse | undefined => {
      if (result?.success && isDesktopEntitlement(result.entitlement)) {
        window.dispatchEvent(
          new CustomEvent<DesktopUsageSnapshot>(DESKTOP_USAGE_UPDATED_EVENT, {
            detail: {
              accountKey,
              entitlement: result.entitlement,
              requestId: result.requestId || null,
              updatedAt: new Date().toISOString(),
            },
          })
        );
      }
      return result;
    })
    .finally(() => {
      if (subscriptionRequests.get(accountKey) === request) {
        subscriptionRequests.delete(accountKey);
      }
    });

  subscriptionRequests.set(accountKey, request);
  return request;
}

export function useUsage({ loadOnMount = true }: UseUsageOptions = {}): UseUsageResult | null {
  const { isSignedIn, user } = useAuth();
  const accountKey = user?.id || "desktop-session";
  const [sttUsage, setSttUsage] = useState<DesktopSttUsage | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionState>(EMPTY_SUBSCRIPTION);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isWaitingForBillingReturn, setIsWaitingForBillingReturn] = useState(false);
  const [isPollingSubscription, setIsPollingSubscription] = useState(false);
  const subscriptionRequest = useRef(0);
  const billingPoll = useRef(0);
  const billingReturnArmed = useRef(false);

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
        const result = await fetchDesktopSubscription(accountKey);
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
        // Apply locally as well as publishing the shared snapshot. This keeps a
        // newly mounted usage surface correct even if it joined an in-flight
        // request just after that request's shared event was emitted.
        setSubscription({
          entitlement: result.entitlement,
          isLoading: false,
          hasLoaded: true,
          error: null,
          errorCode: null,
          requestId: result.requestId || null,
        });
        setSttUsage(entitlementUsage(result.entitlement));
        setUpdatedAt(new Date().toISOString());
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
    [accountKey, isSignedIn]
  );

  const refetch = useCallback(async () => {
    setBillingError(null);
    setIsRefreshing(true);
    try {
      await loadSubscription({ silent: true });
    } finally {
      setIsRefreshing(false);
    }
  }, [loadSubscription]);

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
    try {
      const result = await window.electronAPI.openVoiceLabBilling("desktop");
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
  }, []);

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
    const cleanup = window.electronAPI.onDesktopUsageRefresh?.(() => {
      if (isSignedIn) void loadSubscription({ silent: true });
    });
    return () => cleanup?.();
  }, [isSignedIn, loadSubscription]);

  // Every usage surface owns a hook instance. Share the authoritative desktop
  // response so refreshing Settings updates the sidebar without remounting the
  // control panel or sending duplicate concurrent requests.
  useEffect(() => {
    if (!isSignedIn) return;
    const syncSnapshot = (event: Event) => {
      const snapshot = (event as CustomEvent<DesktopUsageSnapshot>).detail;
      if (!snapshot || snapshot.accountKey !== accountKey) return;
      setSubscription({
        entitlement: snapshot.entitlement,
        isLoading: false,
        hasLoaded: true,
        error: null,
        errorCode: null,
        requestId: snapshot.requestId,
      });
      setSttUsage(entitlementUsage(snapshot.entitlement));
      setUpdatedAt(snapshot.updatedAt);
    };
    window.addEventListener(DESKTOP_USAGE_UPDATED_EVENT, syncSnapshot);
    return () => window.removeEventListener(DESKTOP_USAGE_UPDATED_EVENT, syncSnapshot);
  }, [accountKey, isSignedIn]);

  useEffect(() => {
    setSttUsage(null);
    setUpdatedAt(null);
    setSubscription(EMPTY_SUBSCRIPTION);
    setBillingError(null);
    setIsRefreshing(false);
    billingReturnArmed.current = false;
    setIsWaitingForBillingReturn(false);
    setIsPollingSubscription(false);
    if (isSignedIn && loadOnMount) void loadSubscription();
    return () => {
      subscriptionRequest.current += 1;
      billingPoll.current += 1;
    };
  }, [isSignedIn, user?.id, loadOnMount, loadSubscription]);

  // The synchronous desktop STT response is authoritative for today's usage.
  useEffect(() => {
    const updateFromSttResult = (event: Event) => {
      const detail = (event as CustomEvent<{ usage?: unknown }>).detail;
      if (!isDesktopSttUsage(detail?.usage)) return;
      const nextUsage = detail.usage;
      setSttUsage(nextUsage);
      setSubscription((current) => {
        if (!current.entitlement?.active) return current;
        return {
          ...current,
          entitlement: {
            ...current.entitlement,
            usedSeconds: nextUsage.used_seconds,
            reservedSeconds: 0,
            remainingSeconds: nextUsage.remaining_seconds,
            usageLimitSeconds: nextUsage.limit_seconds,
            usageWindow: nextUsage.usage_window,
          },
        };
      });
      setUpdatedAt(new Date().toISOString());
    };
    window.addEventListener("usage-changed", updateFromSttResult);
    return () => window.removeEventListener("usage-changed", updateFromSttResult);
  }, []);

  const entitlement = subscription.entitlement;

  if (!isSignedIn) return null;

  const isSubscribed = entitlement ? entitlement.active : null;
  const plan = entitlement?.active ? entitlement.planName || entitlement.planId : null;
  return {
    ...STATIC_DESKTOP_STT_DATA,
    updatedAt,
    sttUsage,
    plan,
    entitlement,
    status: entitlement ? (entitlement.active ? "active" : "inactive") : "unknown",
    isSubscribed,
    isOverLimit: sttUsage ? sttUsage.remaining_seconds <= 0 : null,
    isLoading: subscription.isLoading,
    isRefreshing,
    hasLoaded: subscription.hasLoaded,
    hasUsageData: sttUsage !== null,
    hasSubscriptionData: subscription.hasLoaded && entitlement !== null,
    error: billingError || subscription.error,
    errorCode: subscription.errorCode,
    errorRequestId: subscription.requestId,
    checkoutLoading: isWaitingForBillingReturn || isPollingSubscription,
    billingAvailable: true,
    refetch,
    openCheckout: openBilling,
    openBillingPortal: openBilling,
  };
}
