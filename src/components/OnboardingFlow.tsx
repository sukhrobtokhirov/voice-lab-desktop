import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, FileText, Mic, Monitor, Moon, Shield, Sun } from "lucide-react";
import { Button } from "./ui/button";
import AuthenticationStep from "./AuthenticationStep";
import { HotkeyInput } from "./ui/HotkeyInput";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { usePermissions } from "../hooks/usePermissions";
import { useSystemAudioPermission } from "../hooks/useSystemAudioPermission";
import { useSettingsStore } from "../stores/settingsStore";
import { useAuth } from "../hooks/useAuth";
import { formatHotkeyLabelForPlatform, getDefaultHotkey } from "../utils/hotkeys";
import { getPlatform } from "../utils/platform";
import { canManageSystemAudioInApp } from "../utils/systemAudioAccess";
import wordmark from "../assets/voicelab.svg";
import onboardingEndImage from "../assets/bg/3cf7eb296abc1ebbce4daafaf641a4f0.jpg";
import {
  ONBOARDING_STEP_KEY,
  ONBOARDING_STEPS,
  clearOnboardingProgress,
  readOnboardingStep,
  type OnboardingStep,
} from "../constants/onboarding";

interface OnboardingFlowProps {
  onComplete: (options?: { openSettings?: boolean }) => void;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => void;
};

type IntroPhase = "blank-before" | "mark" | "blank-after" | "complete";

const ONBOARDING_UI_LANGUAGES = [
  { value: "uz", label: "O‘zbekcha", flag: "🇺🇿" },
  { value: "en", label: "English", flag: "🇺🇸" },
  { value: "ru", label: "Русский", flag: "🇷🇺" },
] as const;

const ONBOARDING_THEMES = [
  { value: "light", icon: Sun, labelKey: "desktop.onboarding.personalize.light" },
  { value: "dark", icon: Moon, labelKey: "desktop.onboarding.personalize.dark" },
  { value: "auto", icon: Monitor, labelKey: "desktop.onboarding.personalize.system" },
] as const;

const ONBOARDING_NAV_BUTTON_CLASS = "min-w-28";

const CONFETTI_PIECES = [
  [-54, -38, -22, "bg-primary"],
  [-32, -55, 12, "bg-warning"],
  [-8, -48, -34, "bg-success"],
  [20, -56, 27, "bg-foreground"],
  [50, -36, -18, "bg-primary"],
  [-58, -8, 26, "bg-success"],
  [56, -4, -30, "bg-warning"],
  [-43, 28, 18, "bg-foreground"],
  [-15, 42, -14, "bg-primary"],
  [19, 43, 30, "bg-success"],
  [44, 25, -25, "bg-warning"],
  [0, 56, 12, "bg-foreground"],
] as const;

function ConfettiBurst() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {CONFETTI_PIECES.map(([x, y, rotate, color], index) => (
        <span
          key={index}
          className={`onboarding-confetti-piece absolute left-1/2 top-1/2 h-1.5 w-1.5 ${color}`}
          style={
            {
              "--onboarding-confetti-x": `${x}px`,
              "--onboarding-confetti-y": `${y}px`,
              "--onboarding-confetti-rotate": `${rotate}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function updateWithViewTransition(update: () => void) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startViewTransition = (document as ViewTransitionDocument).startViewTransition;

  if (reducedMotion || !startViewTransition) {
    update();
    return;
  }

  startViewTransition.call(document, update);
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<OnboardingStep>(readOnboardingStep);
  const [introPhase, setIntroPhase] = useState<IntroPhase>("blank-before");
  const uiLanguage = useSettingsStore((state) => state.uiLanguage);
  const theme = useSettingsStore((state) => state.theme);
  const setUiLanguage = useSettingsStore((state) => state.setUiLanguage);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const dictationKey = useSettingsStore((state) => state.dictationKey);
  const setDictationKey = useSettingsStore((state) => state.setDictationKey);
  const platform = getPlatform();
  const needsTextInsertionPermission = platform === "darwin";
  const [hotkey, setHotkey] = useState(
    () =>
      localStorage.getItem("hotkey") ||
      dictationKey ||
      (platform === "darwin" ? "Fn" : getDefaultHotkey())
  );
  const [isShortcutDetected, setIsShortcutDetected] = useState(false);
  const [isShortcutCheckOpen, setIsShortcutCheckOpen] = useState(false);
  const [showPermissionNotice, setShowPermissionNotice] = useState(false);
  const permissions = usePermissions(() => setShowPermissionNotice(true));
  const systemAudio = useSystemAudioPermission();
  const { registerHotkey, isRegistering } = useHotkeyRegistration();
  const { isSignedIn } = useAuth();
  const shouldShowSystemAudioPermission = canManageSystemAudioInApp(systemAudio);

  useEffect(() => {
    if (step !== "hotkey") return undefined;

    void window.electronAPI?.setShortcutTestMode?.(true);
    const dispose = window.electronAPI?.onShortcutTested?.(() => {
      setIsShortcutDetected(true);
      setIsShortcutCheckOpen(true);
    });

    return () => {
      dispose?.();
      void window.electronAPI?.setShortcutTestMode?.(false);
    };
  }, [step]);

  const setupPermissionsGranted =
    permissions.micPermissionGranted &&
    (!needsTextInsertionPermission || permissions.accessibilityPermissionGranted);

  useEffect(() => {
    if (setupPermissionsGranted) setShowPermissionNotice(false);
  }, [setupPermissionsGranted]);

  useEffect(() => {
    if (step === "hotkey" && setupPermissionsGranted && !isShortcutDetected) {
      setIsShortcutCheckOpen(true);
    }
  }, [isShortcutDetected, setupPermissionsGranted, step]);

  useEffect(() => {
    if (step !== "hotkey" || !isShortcutDetected) return undefined;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setIsShortcutCheckOpen(false), reducedMotion ? 0 : 1100);

    return () => window.clearTimeout(timer);
  }, [isShortcutDetected, step]);

  const stepIndex = ONBOARDING_STEPS.indexOf(step);
  const shortcutLabel =
    platform === "darwin" && (hotkey === "Fn" || hotkey === "GLOBE")
      ? "Fn"
      : formatHotkeyLabelForPlatform(hotkey, platform);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIntroPhase("complete");
      return undefined;
    }

    const timer = window.setTimeout(() => setIntroPhase("mark"), 500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (introPhase !== "blank-after") return undefined;

    const timer = window.setTimeout(() => setIntroPhase("complete"), 500);
    return () => window.clearTimeout(timer);
  }, [introPhase]);

  const go = useCallback((next: OnboardingStep) => {
    updateWithViewTransition(() => {
      localStorage.setItem(ONBOARDING_STEP_KEY, next);
      setStep(next);
    });
  }, []);

  const finish = useCallback(() => {
    const state = useSettingsStore.getState();
    state.setCloudTranscriptionForAllScopes({
      useLocalWhisper: false,
      cloudTranscriptionMode: "openwhispr",
    });
    localStorage.setItem("transcriptionMode", "openwhispr");
    useSettingsStore.setState({ transcriptionMode: "openwhispr" });
    clearOnboardingProgress();
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    if (step !== "ready" || !isSignedIn) return undefined;

    finish();
    return undefined;
  }, [finish, isSignedIn, step]);

  const canContinue =
    step === "welcome" ||
    step === "mode" ||
    step === "language-permissions" ||
    (step === "hotkey" && setupPermissionsGranted && isShortcutDetected);

  if (introPhase !== "complete") {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        {introPhase === "mark" && (
          <img
            src={wordmark}
            alt="VoiceLab"
            className="h-11 w-auto max-w-56 dark:invert animate-[onboarding-mark-sequence_3800ms_both]"
            onAnimationEnd={() => setIntroPhase("blank-after")}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/35 px-5 py-5 text-foreground animate-[onboarding-content-in_1000ms_cubic-bezier(0.22,1,0.36,1)_both]">
      <section className="relative flex h-[34rem] w-[54rem] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_2px_8px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.22)]">
        {step === "ready" ? (
          <div className="grid flex-1 grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
            <div className="relative min-w-0 bg-muted/30">
              <img src={onboardingEndImage} alt="" className="h-full w-full object-cover" />
              <img
                src={wordmark}
                alt="VoiceLab"
                className="absolute left-7 top-7 h-6 w-auto max-w-40"
              />
              <p className="absolute bottom-7 left-7 max-w-44 text-sm leading-5 text-black/80">
                Make every word sound like it belongs.
              </p>
            </div>
            <div className="flex min-w-0 flex-col px-7 py-8 sm:px-12">
              <nav
                className="absolute left-1/2 top-8 z-10 flex -translate-x-1/2 justify-center gap-1.5"
                aria-label="Onboarding progress"
              >
                {ONBOARDING_STEPS.map((id, index) => (
                  <span
                    key={id}
                    className={`h-1.5 rounded-full transition-colors duration-150 ${
                      index === stepIndex
                        ? "w-5 bg-foreground"
                        : index < stepIndex
                          ? "w-1.5 bg-foreground/50"
                          : "w-1.5 bg-border"
                    }`}
                    aria-label={`${index + 1}. ${t(`desktop.onboarding.progress.${id}`)}`}
                    aria-current={index === stepIndex ? "step" : undefined}
                  />
                ))}
              </nav>
              <main className="flex min-h-0 flex-1 overflow-hidden">
                {!isSignedIn && (
                  <div className="m-auto w-full max-w-sm">
                    <AuthenticationStep onAuthComplete={() => {}} />
                  </div>
                )}
              </main>
              {!isSignedIn && (
                <footer className="flex h-14 shrink-0 items-end justify-center">
                  <div className="flex items-center justify-center gap-3">
                    <Button
                      variant="ghost"
                      size="lg"
                      className={ONBOARDING_NAV_BUTTON_CLASS}
                      onClick={() => go(ONBOARDING_STEPS[Math.max(0, stepIndex - 1)])}
                    >
                      {t("common.back")}
                    </Button>
                  </div>
                </footer>
              )}
            </div>
          </div>
        ) : step === "welcome" || step === "mode" ? (
          <div className="flex flex-1 flex-col px-7 py-8 sm:px-12">
            <nav className="flex justify-center gap-1.5" aria-label="Onboarding progress">
              {ONBOARDING_STEPS.map((id, index) => (
                <span
                  key={id}
                  className={`h-1.5 rounded-full transition-colors duration-150 ${
                    index === stepIndex ? "w-5 bg-foreground" : "w-1.5 bg-border"
                  }`}
                  aria-label={`${index + 1}. ${t(`desktop.onboarding.progress.${id}`)}`}
                  aria-current={index === stepIndex ? "step" : undefined}
                />
              ))}
            </nav>
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              {step === "welcome" ? (
                <>
                  <img src={wordmark} alt="VoiceLab" className="h-9 w-auto dark:invert" />
                  <p className="mt-6 text-sm text-muted-foreground">
                    {t("desktop.onboarding.progress.welcome")}
                  </p>
                </>
              ) : (
                <div className="w-full max-w-xl">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {t("desktop.onboarding.howItWorks.title")}
                  </h1>
                  <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
                    {t("desktop.onboarding.howItWorks.description")}
                  </p>
                  <div
                    className="mx-auto mt-10 grid max-w-md grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-3"
                    role="img"
                    aria-label={t("desktop.onboarding.howItWorks.title")}
                  >
                    <div className="flex flex-col items-center gap-3">
                      <Mic className="h-7 w-7" strokeWidth={1.5} />
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("desktop.onboarding.howItWorks.speak")}
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground/50" strokeWidth={1.5} />
                    <div className="flex flex-col items-center gap-3">
                      <img src={wordmark} alt="" className="h-6 w-auto dark:invert" />
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("desktop.onboarding.howItWorks.voicelab")}
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground/50" strokeWidth={1.5} />
                    <div className="flex flex-col items-center gap-3">
                      <FileText className="h-7 w-7" strokeWidth={1.5} />
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("desktop.onboarding.howItWorks.text")}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <footer className="flex h-14 shrink-0 items-end justify-center">
              <div className="flex items-center justify-center gap-3">
                {stepIndex > 0 && (
                  <Button
                    variant="ghost"
                    size="lg"
                    className={ONBOARDING_NAV_BUTTON_CLASS}
                    onClick={() => go(ONBOARDING_STEPS[Math.max(0, stepIndex - 1)])}
                  >
                    {t("common.back")}
                  </Button>
                )}
                <Button
                  size="lg"
                  className={ONBOARDING_NAV_BUTTON_CLASS}
                  onClick={() =>
                    go(ONBOARDING_STEPS[Math.min(ONBOARDING_STEPS.length - 1, stepIndex + 1)])
                  }
                >
                  {t("common.next")}
                </Button>
              </div>
            </footer>
          </div>
        ) : (
          <div className="flex flex-1 flex-col px-7 py-8 sm:px-12">
            <nav className="flex justify-center gap-1.5" aria-label="Onboarding progress">
              {ONBOARDING_STEPS.map((id, index) => (
                <span
                  key={id}
                  className={`h-1.5 rounded-full transition-colors duration-150 ${
                    index === stepIndex
                      ? "w-5 bg-foreground"
                      : index < stepIndex
                        ? "w-1.5 bg-foreground/50"
                        : "w-1.5 bg-border"
                  }`}
                  aria-label={`${index + 1}. ${t(`desktop.onboarding.progress.${id}`)}`}
                  aria-current={index === stepIndex ? "step" : undefined}
                />
              ))}
            </nav>
            <main className="flex min-h-0 flex-1 overflow-hidden">
              {step === "language-permissions" && (
                <div className="m-auto w-full max-w-xl px-6 py-8">
                  <div className="text-center">
                    <h2 className="text-2xl font-semibold leading-tight tracking-tight">
                      {t("desktop.onboarding.personalize.title")}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {t("desktop.onboarding.personalize.description")}
                    </p>
                  </div>

                  <div className="mx-auto mt-8 max-w-lg space-y-6">
                    <section aria-labelledby="onboarding-interface-language">
                      <h3
                        id="onboarding-interface-language"
                        className="mb-3 text-sm font-medium text-foreground"
                      >
                        {t("desktop.onboarding.personalize.language")}
                      </h3>
                      <div className="grid grid-cols-3 gap-2" role="radiogroup">
                        {ONBOARDING_UI_LANGUAGES.map((language) => {
                          const selected = uiLanguage === language.value;
                          return (
                            <button
                              key={language.value}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => setUiLanguage(language.value)}
                              className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                selected
                                  ? "border-foreground bg-foreground text-background"
                                  : "border-border bg-background hover:bg-accent"
                              }`}
                            >
                              <span aria-hidden="true" className="text-base leading-none">
                                {language.flag}
                              </span>
                              <span>{language.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    <section aria-labelledby="onboarding-appearance">
                      <h3
                        id="onboarding-appearance"
                        className="mb-3 text-sm font-medium text-foreground"
                      >
                        {t("desktop.onboarding.personalize.appearance")}
                      </h3>
                      <div className="grid grid-cols-3 gap-2" role="radiogroup">
                        {ONBOARDING_THEMES.map((option) => {
                          const Icon = option.icon;
                          const selected = theme === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => setTheme(option.value)}
                              className={`flex min-h-14 items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                selected
                                  ? "border-foreground bg-foreground text-background"
                                  : "border-border bg-background hover:bg-accent"
                              }`}
                            >
                              <Icon className="h-4 w-4" strokeWidth={1.7} />
                              <span>{t(option.labelKey)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                </div>
              )}

              {step === "hotkey" && (
                <div className="m-auto flex w-full max-w-lg flex-col items-center px-6 py-3 text-center">
                  <div>
                    <h2 className="text-2xl font-semibold leading-tight tracking-tight">
                      {t("desktop.onboarding.permissions.title")}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {t("desktop.onboarding.permissions.description")}
                    </p>
                  </div>

                  <section
                    className="mt-5 w-full overflow-hidden rounded-lg border border-border"
                    aria-label={t("desktop.onboarding.permissions.title")}
                  >
                    {[
                      {
                        id: "microphone",
                        icon: Mic,
                        title: t("desktop.onboarding.permissions.microphone"),
                        description: t("desktop.onboarding.permissions.microphoneDescription"),
                        granted: permissions.micPermissionGranted,
                        request: permissions.requestMicPermission,
                      },
                      ...(needsTextInsertionPermission
                        ? [
                            {
                              id: "text-insertion",
                              icon: Shield,
                              title: t("desktop.onboarding.permissions.textInsertion"),
                              description: t(
                                "desktop.onboarding.permissions.textInsertionDescription"
                              ),
                              granted: permissions.accessibilityPermissionGranted,
                              request: permissions.requestAccessibilityPermission,
                            },
                          ]
                        : []),
                      ...(shouldShowSystemAudioPermission
                        ? [
                            {
                              id: "system-audio",
                              icon: Monitor,
                              title: t("onboarding.permissions.systemAudioTitle"),
                              description: t("onboarding.permissions.systemAudioDescription"),
                              granted: systemAudio.granted,
                              request: systemAudio.request,
                              pending: systemAudio.isChecking,
                            },
                          ]
                        : []),
                    ].map((permission, index) => {
                      const Icon = permission.icon;
                      const isPending = permission.pending ?? false;
                      return (
                        <div
                          key={permission.id}
                          className={`flex min-h-14 items-center gap-3 px-4 py-2.5 text-left ${
                            index > 0 ? "border-t border-border" : ""
                          } ${permission.granted ? "bg-foreground/[0.03]" : "bg-background"}`}
                        >
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${
                              permission.granted
                                ? "border-foreground bg-foreground text-background"
                                : "border-border bg-muted/50 text-muted-foreground"
                            }`}
                          >
                            {permission.granted ? (
                              <Check className="h-4 w-4" strokeWidth={2.5} />
                            ) : (
                              <Icon className="h-4 w-4" strokeWidth={1.7} />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{permission.title}</span>
                            <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                              {permission.description}
                            </span>
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={permission.granted}
                            aria-label={`${permission.title}: ${
                              permission.granted
                                ? t("desktop.onboarding.permissions.granted")
                                : t("desktop.onboarding.permissions.allow")
                            }`}
                            aria-busy={isPending || undefined}
                            disabled={permission.granted || isPending}
                            onClick={
                              permission.granted || isPending ? undefined : permission.request
                            }
                            className={`relative ml-auto h-6 w-10 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ${
                              permission.granted
                                ? "border-foreground bg-foreground"
                                : "border-border bg-muted/50 hover:border-foreground/40"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-4 w-4 rounded-full transition-[left] duration-150 ${
                                permission.granted
                                  ? "left-5 bg-background"
                                  : "left-0.5 bg-muted-foreground/70"
                              }`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </section>

                  {!setupPermissionsGranted && (
                    <p className="mt-2 text-xs leading-4 text-muted-foreground" role="status">
                      {showPermissionNotice
                        ? t("desktop.onboarding.permissions.permissionNotice")
                        : t("desktop.onboarding.permissions.required")}
                    </p>
                  )}

                  <section className="mt-4 w-full" aria-labelledby="onboarding-shortcut">
                    <h3 id="onboarding-shortcut" className="mb-2 text-sm font-medium">
                      {t("desktop.onboarding.permissions.shortcut")}
                    </h3>
                    <HotkeyInput
                      variant="onboarding"
                      value={hotkey}
                      disabled={isRegistering}
                      onChange={async (value) => {
                        if (await registerHotkey(value)) {
                          setHotkey(value);
                          setIsShortcutDetected(false);
                          setIsShortcutCheckOpen(setupPermissionsGranted);
                          setDictationKey(value);
                          localStorage.setItem("hotkey", value);
                        }
                      }}
                    />
                    {isShortcutDetected && (
                      <p
                        className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-foreground"
                        role="status"
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                        {t("desktop.onboarding.permissions.shortcutDetected")}
                      </p>
                    )}
                  </section>
                </div>
              )}
            </main>
            {step === "hotkey" && isShortcutCheckOpen && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center bg-background/85 px-6"
                role="dialog"
                aria-modal="true"
                aria-labelledby="shortcut-check-title"
              >
                <div className="relative w-full max-w-xs overflow-hidden rounded-lg border border-border bg-card px-6 py-5 text-center shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.32)]">
                  {isShortcutDetected ? (
                    <>
                      <ConfettiBurst />
                      <span className="relative mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-foreground bg-foreground text-background">
                        <Check className="h-5 w-5" strokeWidth={2.5} />
                      </span>
                      <h2
                        id="shortcut-check-title"
                        className="relative mt-3 text-lg font-semibold tracking-tight"
                      >
                        {t("desktop.onboarding.permissions.shortcutDetected")}
                      </h2>
                    </>
                  ) : (
                    <>
                      <kbd className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-muted/40 px-4 text-base font-semibold">
                        {shortcutLabel}
                      </kbd>
                      <h2
                        id="shortcut-check-title"
                        className="mt-3 text-lg font-semibold tracking-tight"
                      >
                        {t("desktop.onboarding.permissions.shortcut")}
                      </h2>
                      <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                        {t("desktop.onboarding.permissions.pressShortcut")}
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
            <footer className="flex h-14 shrink-0 items-end justify-center">
              <div className="flex items-center justify-center gap-3">
                {stepIndex > 0 && (
                  <Button
                    variant="ghost"
                    size="lg"
                    className={ONBOARDING_NAV_BUTTON_CLASS}
                    onClick={() => go(ONBOARDING_STEPS[Math.max(0, stepIndex - 1)])}
                  >
                    {t("common.back")}
                  </Button>
                )}
                <Button
                  size="lg"
                  className={ONBOARDING_NAV_BUTTON_CLASS}
                  disabled={!canContinue}
                  onClick={() =>
                    go(ONBOARDING_STEPS[Math.min(ONBOARDING_STEPS.length - 1, stepIndex + 1)])
                  }
                >
                  {t("common.next")}
                </Button>
              </div>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
