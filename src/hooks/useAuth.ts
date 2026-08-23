import { useCallback, useEffect, useState } from "react";

import type { VoiceLabUser } from "../lib/auth";
import type { DesktopProfile } from "../types/electron";
import { useSettingsStore } from "../stores/settingsStore";

type DesktopAuthState = {
  status: string;
  user: VoiceLabUser | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorRequestId?: string | null;
  errorFields?: Record<string, string> | null;
  retryAfterSeconds?: number | null;
};

const initialState: DesktopAuthState = {
  status: "loading",
  user: null,
  errorCode: null,
  errorMessage: null,
};

function mergeProfile(user: VoiceLabUser, profile: DesktopProfile): VoiceLabUser {
  if (profile.user.id !== user.id) return user;
  return {
    ...user,
    name: profile.user.displayName || user.name,
    image: profile.user.avatarUrl || user.image || null,
  };
}

export function useAuth() {
  const [authState, setAuthState] = useState<DesktopAuthState>(initialState);

  const applyAuthState = useCallback((next: DesktopAuthState) => {
    setAuthState(next);
    useSettingsStore.getState().setIsSignedIn(next.status === "authenticated");
  }, []);

  const hydrateUserProfile = useCallback(async (user: VoiceLabUser | null) => {
    if (!user) return;
    const profile = await window.electronAPI?.authGetProfile?.().catch(() => null);
    if (!profile) return;
    setAuthState((current) => {
      if (current.status !== "authenticated" || !current.user || current.user.id !== user.id) {
        return current;
      }
      const mergedUser = mergeProfile(current.user, profile);
      return mergedUser.name === current.user.name && mergedUser.image === current.user.image
        ? current
        : { ...current, user: mergedUser };
    });
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
    if (next?.status === "authenticated") {
      void hydrateUserProfile(next.user as VoiceLabUser | null);
    }
    return next || null;
  }, [applyAuthState, hydrateUserProfile]);

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
          if (next.status === "authenticated") {
            void hydrateUserProfile(next.user as VoiceLabUser | null);
          }
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
        if (next.status === "authenticated") {
          void hydrateUserProfile(next.user as VoiceLabUser | null);
        }
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
  }, [applyAuthState, hydrateUserProfile]);

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
    authErrorRequestId: authState.errorRequestId || null,
    authErrorFields: authState.errorFields || null,
    authRetryAfterSeconds: authState.retryAfterSeconds || null,
    refetch,
  };
}
