export const ONBOARDING_FLOW_VERSION = 2;
export const ONBOARDING_STEP_KEY = `voicelab:onboarding-step:v${ONBOARDING_FLOW_VERSION}`;

export const ONBOARDING_STEPS = [
  "welcome",
  "mode",
  "language-permissions",
  "hotkey",
  "ready",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const LEGACY_ONBOARDING_STEP_KEY = "onboardingCurrentStep";
const LEGACY_STEP_MAP: OnboardingStep[] = [
  "welcome",
  "mode",
  "language-permissions",
  "language-permissions",
  "language-permissions",
  "hotkey",
  "hotkey",
  "ready",
  "ready",
];

export function readOnboardingStep(): OnboardingStep {
  const saved = localStorage.getItem(ONBOARDING_STEP_KEY) as OnboardingStep | null;
  if (saved && ONBOARDING_STEPS.includes(saved)) return saved;

  const legacy = Number.parseInt(localStorage.getItem(LEGACY_ONBOARDING_STEP_KEY) || "", 10);
  const migrated = Number.isFinite(legacy)
    ? LEGACY_STEP_MAP[Math.min(Math.max(legacy, 0), LEGACY_STEP_MAP.length - 1)]
    : "welcome";

  localStorage.setItem(ONBOARDING_STEP_KEY, migrated);
  localStorage.removeItem(LEGACY_ONBOARDING_STEP_KEY);
  return migrated;
}

export function hasOnboardingProgress(): boolean {
  if (localStorage.getItem(ONBOARDING_STEP_KEY)) return true;
  if (!localStorage.getItem(LEGACY_ONBOARDING_STEP_KEY)) return false;
  readOnboardingStep();
  return true;
}

export function clearOnboardingProgress(): void {
  localStorage.removeItem(ONBOARDING_STEP_KEY);
  localStorage.removeItem(LEGACY_ONBOARDING_STEP_KEY);
}
