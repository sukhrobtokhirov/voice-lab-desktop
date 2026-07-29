import { useCallback, useEffect, useState } from "react";

import type { VoiceLabUser } from "../lib/auth";

type DesktopAuthState = {
  status: string;
  user: VoiceLabUser | null;
  errorCode: string | null;
};

const initialState: DesktopAuthState = {
  status: "loading",
  user: null,
  errorCode: null,
};

export function useAuth() {
  const [authState, setAuthState] = useState<DesktopAuthState>(initialState);

  const refetch = useCallback(async () => {
    const next = await window.electronAPI?.authGetStatus?.();
    if (next) setAuthState({ ...next, user: next.user as VoiceLabUser | null });
    else setAuthState({ status: "signed-out", user: null, errorCode: null });
    return next || null;
  }, []);

  useEffect(() => {
    let mounted = true;
    window.electronAPI
      ?.authGetStatus?.()
      .then((next) => {
        if (mounted && next) {
          setAuthState({ ...next, user: next.user as VoiceLabUser | null });
        }
      })
      .catch(() => {
        if (mounted) {
          setAuthState({
            status: "error",
            user: null,
            errorCode: "AUTH_STATUS_UNAVAILABLE",
          });
        }
      });

    const unsubscribe = window.electronAPI?.onAuthStateChanged?.((next) => {
      if (mounted) setAuthState({ ...next, user: next.user as VoiceLabUser | null });
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const isSignedIn = authState.status === "authenticated";

  return {
    isSignedIn,
    isGracePeriodOnly: false,
    isLoaded: authState.status !== "loading",
    session: isSignedIn ? { user: authState.user } : null,
    user: authState.user,
    authStatus: authState.status,
    authErrorCode: authState.errorCode,
    refetch,
  };
}
