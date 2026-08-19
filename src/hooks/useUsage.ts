import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";

export interface CreditWalletData {
  isUnlimited: boolean;
  balanceCredits: string;
  reservedCredits: string;
  availableCredits: string;
  plan: string;
  estimatedCredits: string | null;
  chargedCredits: string | null;
  limits: Record<string, unknown>;
  topUpUrl: string | null;
  updatedAt: string | null;
  supportedLanguages: string[];
  autoDetectionSupported: boolean;
}

interface UseUsageResult extends CreditWalletData {
  status: string;
  isSubscribed: boolean;
  isOverLimit: boolean;
  isLoading: boolean;
  hasLoaded: boolean;
  error: string | null;
  errorCode: string | null;
  checkoutLoading: boolean;
  refetch: () => Promise<void>;
  openCheckout: () => Promise<{ success: boolean; error?: string }>;
  openBillingPortal: () => Promise<{ success: boolean; error?: string }>;
}

const EMPTY: CreditWalletData = {
  isUnlimited: false,
  balanceCredits: "0",
  reservedCredits: "0",
  availableCredits: "0",
  plan: "free",
  estimatedCredits: null,
  chargedCredits: null,
  limits: {},
  topUpUrl: null,
  updatedAt: null,
  supportedLanguages: [],
  autoDetectionSupported: false,
};

export function useUsage(): UseUsageResult | null {
  const { isSignedIn, isLoaded } = useAuth();
  const [data, setData] = useState<CreditWalletData>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const billingWindowPending = useRef(false);

  const fetchUsage = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const task = (async () => {
      setIsLoading(true);
      setError(null);
      setErrorCode(null);
      try {
        const result = await window.electronAPI.cloudUsage?.();
        if (!result?.success) {
          setError(result?.error || "Unable to load AI Credit wallet.");
          setErrorCode(result?.code || "WALLET_UNAVAILABLE");
          return;
        }
        const response = result as typeof result & {
          supported_languages?: string[];
          supportedLanguages?: string[];
          auto_detection_supported?: boolean;
          autoDetectionSupported?: boolean;
        };
        const limits = (result.limits ?? {}) as Record<string, unknown>;
        setData({
          isUnlimited: result.isUnlimited === true,
          balanceCredits: String(result.balanceCredits ?? "0"),
          reservedCredits: String(result.reservedCredits ?? "0"),
          availableCredits: String(result.availableCredits ?? "0"),
          plan: result.plan ?? "free",
          estimatedCredits:
            result.estimatedCredits == null ? null : String(result.estimatedCredits),
          chargedCredits: result.chargedCredits == null ? null : String(result.chargedCredits),
          limits,
          topUpUrl: result.topUpUrl ?? null,
          updatedAt: result.updatedAt ?? null,
          supportedLanguages:
            response.supportedLanguages ??
            response.supported_languages ??
            (Array.isArray(limits.supported_languages)
              ? (limits.supported_languages as string[])
              : []),
          autoDetectionSupported: Boolean(
            response.autoDetectionSupported ??
            response.auto_detection_supported ??
            limits.auto_detection_supported
          ),
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to load AI Credit wallet.");
        setErrorCode("WALLET_UNAVAILABLE");
      } finally {
        setIsLoading(false);
        setHasLoaded(true);
      }
    })();
    inFlight.current = task.finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setData(EMPTY);
      setIsLoading(false);
      return;
    }
    void fetchUsage();
    const changed = () => void fetchUsage();
    const refreshAfterBilling = () => {
      if (!billingWindowPending.current) return;
      billingWindowPending.current = false;
      void fetchUsage();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshAfterBilling();
    };
    window.addEventListener("usage-changed", changed);
    window.addEventListener("focus", refreshAfterBilling);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("usage-changed", changed);
      window.removeEventListener("focus", refreshAfterBilling);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isLoaded, isSignedIn, fetchUsage]);

  const openBilling = useCallback(async () => {
    if (!window.electronAPI.openVoiceLabBilling) {
      return { success: false, error: "Billing is unavailable." };
    }
    const result = await window.electronAPI.openVoiceLabBilling("dictate");
    if (result?.success) billingWindowPending.current = true;
    return result;
  }, []);

  if (!isSignedIn) return null;
  const available = Number(data.availableCredits);

  return {
    ...data,
    status: errorCode ? "unavailable" : "active",
    isSubscribed: data.plan !== "free",
    isOverLimit: !data.isUnlimited && Number.isFinite(available) && available <= 0,
    isLoading,
    hasLoaded,
    error,
    errorCode,
    checkoutLoading: false,
    refetch: fetchUsage,
    openCheckout: openBilling,
    openBillingPortal: openBilling,
  };
}
