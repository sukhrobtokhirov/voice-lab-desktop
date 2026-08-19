import { useCallback, useEffect, useState } from "react";

import type { VoiceLabUser } from "../lib/auth";
import { useSettingsStore } from "../stores/settingsStore";

type DesktopAuthState = {
  status: string;
  user: VoiceLabUser | null;
  errorCode: string | null;
  errorMessage: string | null;
};

const initialState: DesktopAuthState = {
  status: "loading",
  user: null,
  errorCode: null,
  errorMessage: null,
};

export function useAuth() {
  const [authState, setAuthState] = useState<DesktopAuthState>(initialState);

  const applyAuthState = useCallback((next: DesktopAuthState) => {
    setAuthState(next);
    useSettingsStore.getState().setIsSignedIn(next.status === "authenticated");
  }, []);

  const refetch = useCallback(async () => {
    const next = await window.electronAPI?.authGetStatus?.();
    if (next)
      applyAuthState({
        ...next,
        user: next.user as VoiceLabUser | null,
        errorMessage: next.errorMessage || null,
      });
    else applyAuthState({ status: "signed-out", user: null, errorCode: null, errorMessage: null });
    return next || null;
  }, [applyAuthState]);

  useEffect(() => {
    let mounted = true;
    window.electronAPI
      ?.authGetStatus?.()
      .then((next) => {
        if (mounted && next) {
          applyAuthState({
            ...next,
            user: next.user as VoiceLabUser | null,
            errorMessage: next.errorMessage || null,
          });
        }
      })
      .catch(() => {
        if (mounted) {
          applyAuthState({
            status: "error",
            user: null,
            errorCode: "AUTH_STATUS_UNAVAILABLE",
            errorMessage: "Authentication status is unavailable",
          });
        }
      });

    const unsubscribe = window.electronAPI?.onAuthStateChanged?.((next) => {
      if (mounted)
        applyAuthState({
          ...next,
          user: next.user as VoiceLabUser | null,
          errorMessage: next.errorMessage || null,
        });
    });
    const unsubscribeProtocolError = window.electronAPI?.onDesktopProtocolError?.(
      (_event, payload) => {
        if (mounted) {
          applyAuthState({
            status: "error",
            user: null,
            errorCode: payload?.errorCode || "AUTH_CALLBACK_INVALID",
            errorMessage: "Authentication return link could not be processed",
          });
        }
      }
    );

    return () => {
      mounted = false;
      unsubscribe?.();
      unsubscribeProtocolError?.();
    };
  }, [applyAuthState]);

  const isSignedIn = authState.status === "authenticated";
  const isPending = [
    "checking-session",
    "opening",
    "opening-browser",
    "waiting",
    "waiting-for-browser",
    "exchanging",
  ].includes(authState.status);

  return {
    isSignedIn,
    isGracePeriodOnly: false,
    isLoaded: authState.status !== "loading",
    isPending,
    session: isSignedIn ? { user: authState.user } : null,
    user: authState.user,
    authStatus: authState.status,
    authErrorCode: authState.errorCode,
    authErrorMessage: authState.errorMessage,
    refetch,
  };
}
