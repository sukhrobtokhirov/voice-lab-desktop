import { useCallback } from "react";
import { ONBOARDING_STEP_KEY } from "../constants/onboarding";

// Restart the onboarding flow from the cloud-migration step (used when a
// settings panel needs the user to sign in for OpenWhispr Cloud).
export function useStartOnboarding() {
  return useCallback(() => {
    localStorage.setItem("pendingCloudMigration", "true");
    localStorage.setItem(ONBOARDING_STEP_KEY, "welcome");
    localStorage.removeItem("onboardingCompleted");
    window.location.reload();
  }, []);
}
