import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowUpRight, Loader2, ShieldCheck, X } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { cancelBrowserSignIn, reopenBrowserSignIn, signInWithSocial } from "../lib/auth";
import { Button } from "./ui/button";
import wordmark from "../assets/voicelab.svg";

interface AuthenticationStepProps {
  onAuthComplete: () => void;
  onNeedsVerification?: (email: string) => void;
}

const WAITING_STATUSES = new Set(["waiting", "waiting-for-browser"]);
const BUSY_STATUSES = new Set([
  "loading",
  "checking-session",
  "opening",
  "opening-browser",
  "exchanging",
]);

const AUTH_ERROR_KEYS: Record<string, string> = {
  AUTH_NETWORK_TIMEOUT: "auth.desktopNetworkTimeout",
  AUTH_BACKEND_RESPONSE_INVALID: "auth.desktopInvalidResponse",
  AUTHORIZATION_RESPONSE_INVALID: "auth.desktopInvalidResponse",
  AUTH_TOKEN_RESPONSE_INVALID: "auth.desktopInvalidResponse",
  AUTH_USER_RESPONSE_INVALID: "auth.desktopInvalidResponse",
  AUTH_REFRESH_ROTATION_REQUIRED: "auth.desktopInvalidResponse",
  AUTH_CALLBACK_INVALID: "auth.desktopCallbackInvalid",
  AUTH_STATE_MISMATCH: "auth.desktopCallbackInvalid",
  AUTH_TRANSACTION_INVALID: "auth.desktopCallbackInvalid",
  AUTH_TRANSACTION_MISSING: "auth.desktopCallbackInvalid",
  AUTH_CALLBACK_SERVER_FAILED: "auth.desktopUnavailable",
  AUTH_STATUS_UNAVAILABLE: "auth.desktopUnavailable",
  AUTH_PLATFORM_UNSUPPORTED: "auth.desktopSecurityError",
  AUTHORIZATION_ORIGIN_REJECTED: "auth.desktopSecurityError",
  AUTHORIZATION_URL_INVALID: "auth.desktopSecurityError",
  AUTH_CALLBACK_REPLAYED: "auth.desktopReplayDetected",
  AUTH_TRANSACTION_EXPIRED: "auth.desktopExpired",
  AUTH_EXPIRED: "auth.desktopUnauthorized",
  AUTH_PROFILE_REQUIRED: "auth.desktopUnauthorized",
  invalid_refresh_token: "auth.desktopUnauthorized",
  account_disabled: "auth.desktopUnauthorized",
  rate_limited: "auth.desktopServerRejected",
  auth_unavailable: "auth.desktopUnavailable",
  invalid_json: "auth.desktopServerRejected",
  payload_too_large: "auth.desktopServerRejected",
  validation_error: "auth.desktopServerRejected",
  AUTH_ACCESS_DENIED: "auth.desktopCancelled",
  AUTH_CANCELLED_BY_USER: "auth.desktopCancelled",
  AUTH_UNAUTHORIZED: "auth.desktopUnauthorized",
  AUTH_REQUIRED: "auth.desktopUnauthorized",
  AUTH_SESSION_INVALID: "auth.desktopUnauthorized",
  AUTH_MANAGER_UNAVAILABLE: "auth.desktopUnavailable",
  AUTH_BACKEND_REJECTED: "auth.desktopServerRejected",
  AUTH_START_FAILED: "auth.desktopServerRejected",
  AUTH_EXCHANGE_FAILED: "auth.desktopServerRejected",
  AUTH_CALLBACK_ERROR: "auth.desktopServerRejected",
  AUTH_REFRESH_FAILED: "auth.desktopServerRejected",
};

function localizedAuthError(t: (key: string) => string, errorCode?: string | null) {
  return t(AUTH_ERROR_KEYS[errorCode || ""] || "auth.desktopFailed");
}

export default function AuthenticationStep({ onAuthComplete }: AuthenticationStepProps) {
  const { t } = useTranslation();
  const {
    isSignedIn,
    isLoaded,
    authStatus,
    authErrorCode,
    authErrorMessage,
    authErrorRequestId,
    authErrorFields,
    authRetryAfterSeconds,
  } = useAuth();
  const [opening, setOpening] = useState(false);
  const [protocolReady, setProtocolReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);
  const waiting = WAITING_STATUSES.has(authStatus);
  const busy = opening || BUSY_STATUSES.has(authStatus);

  useEffect(() => {
    window.electronAPI
      ?.getOAuthProtocolRegistered?.()
      .then(setProtocolReady)
      .catch(() => setProtocolReady(false));
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) onAuthComplete();
  }, [isLoaded, isSignedIn, onAuthComplete]);

  useEffect(() => {
    if (waiting) {
      setOpening(false);
      setError(authErrorCode ? localizedAuthError(t, authErrorCode) : null);
    }
    if (authStatus === "authenticated") {
      setOpening(false);
      setError(null);
    }
    if (authStatus === "cancelled") {
      setOpening(false);
      setError(t("auth.desktopCancelled"));
      return;
    }
    if (authStatus === "expired") {
      setOpening(false);
      setError(t("auth.desktopExpired"));
      return;
    }
    if (authStatus === "error") {
      setOpening(false);
      setError(localizedAuthError(t, authErrorCode));
      return;
    }
    if (authStatus === "signed-out") {
      setOpening(false);
      setError(authErrorCode ? localizedAuthError(t, authErrorCode) : null);
    }
  }, [authErrorCode, authStatus, t, waiting]);

  const start = useCallback(async () => {
    setOpening(true);
    setError(null);
    const result = await signInWithSocial("google");
    if (result.error) {
      setOpening(false);
      setError(localizedAuthError(t, result.errorCode));
    }
  }, [t]);

  const reopen = useCallback(async () => {
    setError(null);
    const result = await reopenBrowserSignIn();
    if (result.error) setError(localizedAuthError(t, result.errorCode));
  }, [t]);

  const cancel = useCallback(async () => {
    await cancelBrowserSignIn();
  }, []);

  useEffect(() => {
    if (
      autoStarted.current ||
      !isLoaded ||
      isSignedIn ||
      Boolean(authErrorCode) ||
      protocolReady !== true ||
      authStatus !== "signed-out"
    ) {
      return;
    }
    autoStarted.current = true;
    void start();
  }, [authErrorCode, authStatus, isLoaded, isSignedIn, protocolReady, start]);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <img
          src={wordmark}
          alt="VoiceLab"
          className="mx-auto mb-5 h-8 w-auto max-w-44 dark:invert"
        />
        <h2 className="text-2xl font-semibold tracking-tight">{t("auth.desktopTitle")}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {waiting ? t("auth.desktopWaiting") : t("auth.desktopBrowserHint")}
        </p>
      </div>

      <div className="rounded-[10px] border border-border bg-muted/40 px-4 py-3 text-sm leading-5 text-muted-foreground">
        <div className="flex gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
          {t("auth.desktopSecurity")}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex gap-2 rounded-[10px] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p>{error}</p>
            {authErrorMessage && authErrorMessage !== error && (
              <p className="mt-1 break-words text-xs opacity-85">{authErrorMessage}</p>
            )}
            {authRetryAfterSeconds && (
              <p className="mt-1 text-xs opacity-85">
                {t("auth.desktopRetryAfter", { seconds: authRetryAfterSeconds })}
              </p>
            )}
            {authErrorFields && Object.keys(authErrorFields).length > 0 && (
              <ul className="mt-1 list-inside list-disc text-xs opacity-85">
                {Object.entries(authErrorFields).map(([field, message]) => (
                  <li key={field}>{field}: {message}</li>
                ))}
              </ul>
            )}
            {authErrorCode && (
              <code className="mt-1 block break-all font-mono text-xs leading-5 opacity-70">
                {authErrorCode}
              </code>
            )}
            {authErrorRequestId && (
              <code className="mt-1 block break-all font-mono text-xs leading-5 opacity-70">
                {authErrorRequestId}
              </code>
            )}
          </div>
        </div>
      )}

      {protocolReady === false && (
        <p className="text-sm text-destructive">{t("auth.desktopProtocolUnavailable")}</p>
      )}

      {waiting ? (
        <div className="grid gap-2.5">
          <Button className="h-12 w-full rounded-full" onClick={reopen}>
            <ArrowUpRight className="h-4 w-4" />
            {t("auth.desktopReopen")}
          </Button>
          <Button variant="ghost" className="h-10 w-full rounded-full" onClick={cancel}>
            <X className="h-4 w-4" />
            {t("auth.desktopCancel")}
          </Button>
        </div>
      ) : (
        <Button
          className="h-12 w-full rounded-full"
          onClick={start}
          disabled={busy || protocolReady !== true}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUpRight className="h-4 w-4" />
          )}
          {busy ? t("auth.desktopOpening") : t("auth.desktopOpenBrowser")}
        </Button>
      )}
    </div>
  );
}
