import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Command, Languages, LogIn, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import WindowControls from "./WindowControls";
import StepProgress from "./ui/StepProgress";
import PermissionsSection from "./ui/PermissionsSection";
import LanguageSelector from "./ui/LanguageSelector";
import { getDesktopLanguageOptions } from "../config/desktopLanguageOptions";
import AuthenticationStep from "./AuthenticationStep";
import { HotkeyInput } from "./ui/HotkeyInput";
import { usePermissions } from "../hooks/usePermissions";
import { useSystemAudioPermission } from "../hooks/useSystemAudioPermission";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { useSettingsStore } from "../stores/settingsStore";
import { useUsage } from "../hooks/useUsage";
import { useAuth } from "../hooks/useAuth";
import type { DesktopLanguageCode, DesktopLanguageProvider } from "../config/desktopLanguages";
import logoIcon from "../assets/icon.png";
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

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<OnboardingStep>(readOnboardingStep);
  const preferredLanguage = useSettingsStore((state) => state.preferredLanguage) as DesktopLanguageCode;
  const [hotkey, setHotkey] = useState(() => localStorage.getItem("hotkey") || "CommandOrControl+Shift+Space");
  const [testText, setTestText] = useState("");
  const permissions = usePermissions();
  const systemAudio = useSystemAudioPermission();
  const { registerHotkey, isRegistering } = useHotkeyRegistration();
  const usage = useUsage();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (step !== "hotkey") return undefined;

    return window.electronAPI?.onDictationComplete?.(({ text }) => {
      const result = typeof text === "string" ? text.trim() : "";
      if (result) setTestText(result);
    });
  }, [step]);

  const stepIndex = ONBOARDING_STEPS.indexOf(step);
  const provider: DesktopLanguageProvider = "voicelab";
  const cloudCapabilities = useMemo(
    () =>
      usage?.hasLoaded && !usage.isLoading && !usage.error
        ? {
            supportedLanguages: usage.supportedLanguages,
            autoDetectionSupported: usage.autoDetectionSupported,
          }
        : undefined,
    [
      usage?.hasLoaded,
      usage?.isLoading,
      usage?.error,
      usage?.supportedLanguages,
      usage?.autoDetectionSupported,
    ]
  );
  const languageOptions = useMemo(
    () => getDesktopLanguageOptions(provider, cloudCapabilities),
    [cloudCapabilities, provider]
  );
  const selectedSupported = languageOptions.some((item) => item.value === preferredLanguage && !item.disabled);

  const go = useCallback((next: OnboardingStep) => {
    localStorage.setItem(ONBOARDING_STEP_KEY, next);
    setStep(next);
  }, []);

  useEffect(() => {
    const authStepIndex = ONBOARDING_STEPS.indexOf("mode");
    if (authLoaded && !isSignedIn && stepIndex > authStepIndex) {
      go("mode");
    }
  }, [authLoaded, go, isSignedIn, stepIndex]);

  const setLanguage = useCallback((language: string) => {
    localStorage.setItem("preferredLanguage", language);
    useSettingsStore.setState({ preferredLanguage: language });
  }, []);

  useEffect(() => {
    if (step !== "language-permissions" || selectedSupported || usage?.isLoading) return;
    const fallback = languageOptions.find((item) => item.value !== "auto" && !item.disabled);
    if (fallback && fallback.value !== preferredLanguage) setLanguage(fallback.value);
  }, [
    languageOptions,
    preferredLanguage,
    selectedSupported,
    setLanguage,
    step,
    usage?.isLoading,
  ]);

  const finish = () => {
    const state = useSettingsStore.getState();
    state.setCloudTranscriptionForAllScopes({ useLocalWhisper: false, cloudTranscriptionMode: "openwhispr" });
    localStorage.setItem("transcriptionMode", "openwhispr");
    useSettingsStore.setState({ transcriptionMode: "openwhispr" });
    clearOnboardingProgress();
    onComplete();
  };

  const canContinue =
    step === "welcome" ||
    (step === "language-permissions" && selectedSupported && permissions.micPermissionGranted) ||
    step === "hotkey";

  const progress = ONBOARDING_STEPS.map((id) => ({
    title: t(`desktop.onboarding.progress.${id}`),
    icon: { welcome: Sparkles, mode: LogIn, "language-permissions": Languages, hotkey: Command, ready: CheckCircle2 }[id],
  }));

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex h-10 items-center justify-end border-b border-border px-2 [app-region:drag]">
        <div className="[app-region:no-drag]">
          <WindowControls />
        </div>
      </div>
      <div className="border-b border-border px-5 py-3">
        <StepProgress steps={progress} currentStep={stepIndex} />
      </div>
      <main className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col overflow-y-auto px-6 py-7">
        {step === "welcome" && (
          <div className="my-auto space-y-5 text-center">
            <img src={logoIcon} alt="VoiceLab" className="mx-auto h-16 w-16 rounded-2xl" />
            <div>
              <h1 className="text-2xl font-semibold leading-tight tracking-tight">
                {t("desktop.onboarding.welcome.title")}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t("desktop.onboarding.welcome.description")}
              </p>
            </div>
          </div>
        )}

        {step === "mode" && (
          <div className="my-auto">
            <AuthenticationStep onAuthComplete={() => go("language-permissions")} />
          </div>
        )}

        {step === "language-permissions" && (
          <div className="my-auto space-y-5">
            <div>
              <h2 className="text-xl font-semibold leading-tight tracking-tight">
                {t("desktop.onboarding.language.title")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("desktop.onboarding.language.description")}
              </p>
            </div>
            {usage?.isLoading && (
              <p
                role="status"
                className="rounded-lg bg-muted/60 px-3 py-2 text-sm leading-5 text-muted-foreground"
              >
                {t("desktop.onboarding.language.loadingCapabilities")}
              </p>
            )}
            {usage?.error && (
              <p
                role="status"
                className="rounded-lg bg-amber-500/8 px-3 py-2 text-sm leading-5 text-amber-700 dark:text-amber-300"
              >
                {t("desktop.onboarding.language.capabilitiesUnavailable")}
              </p>
            )}
            <LanguageSelector value={preferredLanguage} onChange={setLanguage} options={languageOptions} provider={provider} />
            {!selectedSupported && (
              <p role="alert" className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-3 text-sm text-amber-700 dark:text-amber-300">
                {t("desktop.onboarding.language.unsupported")}
              </p>
            )}
            <PermissionsSection permissions={permissions} systemAudio={systemAudio} />
            {!permissions.micPermissionGranted && (
              <p className="text-sm leading-5 text-muted-foreground">
                {t("desktop.onboarding.language.microphoneRequired")}
              </p>
            )}
          </div>
        )}

        {step === "hotkey" && (
          <div className="my-auto space-y-5">
            <div>
              <h2 className="text-xl font-semibold leading-tight tracking-tight">
                {t("desktop.onboarding.hotkey.title")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("desktop.onboarding.hotkey.description")}
              </p>
            </div>
            <HotkeyInput value={hotkey} disabled={isRegistering} variant="hero" onChange={async (value) => { if (await registerHotkey(value)) { setHotkey(value); localStorage.setItem("hotkey", value); } }} />
            <Textarea value={testText} onChange={(event) => setTestText(event.target.value)} placeholder={t("desktop.onboarding.hotkey.placeholder")} className="min-h-24" autoFocus />
          </div>
        )}

        {step === "ready" && (
          <div className="my-auto space-y-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-7 w-7 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight">
                {t("desktop.onboarding.ready.title")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t("desktop.onboarding.ready.account")}
              </p>
            </div>
          </div>
        )}
      </main>
      <footer className="flex shrink-0 items-center justify-between border-t border-border bg-background px-6 py-4">
        <Button variant="ghost" disabled={stepIndex === 0} onClick={() => go(ONBOARDING_STEPS[Math.max(0, stepIndex - 1)])}>{t("common.back")}</Button>
        {step === "ready" ? <Button onClick={finish}>{t("desktop.onboarding.ready.start")}</Button> : step === "mode" ? <span /> : <Button disabled={!canContinue} onClick={() => go(ONBOARDING_STEPS[Math.min(ONBOARDING_STEPS.length - 1, stepIndex + 1)])}>{t("common.next")}</Button>}
      </footer>
    </div>
  );
}
