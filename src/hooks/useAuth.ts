/**
 * Auth is temporarily disabled for VoiceLab Desktop Sprint 2.
 * Cloud STT uses AISHA_API_KEY (X-Api-Key) — no account session required.
 */

export function useAuth() {
  return {
    isSignedIn: false,
    isGracePeriodOnly: false,
    isLoaded: true,
    session: null,
    user: null,
    refetch: async () => null,
  };
}
