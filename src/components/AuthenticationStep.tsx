import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { cancelBrowserSignIn, reopenBrowserSignIn, signInWithSocial } from "../lib/auth";
import { Button } from "./ui/button";

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

export default function AuthenticationStep({ onAuthComplete }: AuthenticationStepProps) {
  const { t } = useTranslation();
  const { isSignedIn, isLoaded, authStatus } = useAuth();
  const [opening, setOpening] = useState(false);
  const [protocolReady, setProtocolReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
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
      setError(null);
      return;
    }
    if (authStatus === "authenticated") {
      setOpening(false);
      setError(null);
      return;
    }
    if (!hasStarted) return;

    if (authStatus === "cancelled") {
      setOpening(false);
      setError(t("auth.desktopCancelled"));
      return;
    }
    if (authStatus === "expired" || authStatus === "error") {
      setOpening(false);
      setError(t("auth.desktopFailed"));
      return;
    }
    if (authStatus === "signed-out") {
      setOpening(false);
    }
  }, [authStatus, hasStarted, t, waiting]);

  const start = useCallback(async () => {
    setHasStarted(true);
    setOpening(true);
    setError(null);
    const result = await signInWithSocial("google");
    if (result.error) {
      setOpening(false);
      setError(t("auth.desktopFailed"));
    }
  }, [t]);

  const reopen = useCallback(async () => {
    setHasStarted(true);
    setError(null);
    const result = await reopenBrowserSignIn();
    if (result.error) setError(t("auth.desktopFailed"));
  }, [t]);

  const cancel = useCallback(async () => {
    await cancelBrowserSignIn();
  }, []);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight">{t("auth.desktopTitle")}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {waiting ? t("auth.desktopWaiting") : t("auth.desktopBrowserHint")}
        </p>
      </div>

      {error && (
        <p role="status" className="text-center text-sm leading-5 text-muted-foreground">
          {error}
        </p>
      )}

      {waiting ? (
        <div className="grid gap-3">
          <div className="flex justify-center py-0.5" role="status" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t("auth.desktopWaiting")}</span>
          </div>
          <Button variant="outline" className="h-11 w-full rounded-lg" onClick={reopen}>
            {t("auth.desktopReopen")}
          </Button>
          <Button
            variant="ghost"
            className="h-10 w-full rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={cancel}
          >
            {t("auth.desktopCancel")}
          </Button>
        </div>
      ) : (
        <Button
          className="h-12 w-full rounded-lg"
          onClick={start}
          disabled={busy || protocolReady === null}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? t("auth.desktopOpening") : t("auth.desktopOpenBrowser")}
        </Button>
      )}
    </div>
  );
}
