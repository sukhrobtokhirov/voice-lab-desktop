import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Command, HardDrive, KeyRound, Languages, LogIn, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import WindowControls from "./WindowControls";
import StepProgress from "./ui/StepProgress";
import PermissionsSection from "./ui/PermissionsSection";
import LanguageSelector, { getDesktopLanguageOptions } from "./ui/LanguageSelector";
import AuthenticationStep from "./AuthenticationStep";
import { HotkeyInput } from "./ui/HotkeyInput";
import { usePermissions } from "../hooks/usePermissions";
import { useSystemAudioPermission } from "../hooks/useSystemAudioPermission";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { useSettingsStore } from "../stores/settingsStore";
import { useUsage } from "../hooks/useUsage";
import type { DesktopLanguageCode, DesktopLanguageProvider } from "../config/desktopLanguages";
import logoIcon from "../assets/icon.png";
import {
  ONBOARDING_STEP_KEY,
  ONBOARDING_STEPS,
  clearOnboardingProgress,
  readOnboardingStep,
  type OnboardingStep,
} from "../constants/onboarding";

const MODE_KEY = "voicelab:onboarding-mode:v1";
type SetupMode = "account" | "local" | "api-key";

interface OnboardingFlowProps {
  onComplete: (options?: { openSettings?: boolean }) => void;
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<OnboardingStep>(readOnboardingStep);
  const [mode, setMode] = useState<SetupMode>(() => {
    const saved = localStorage.getItem(MODE_KEY);
    return saved === "account" || saved === "local" || saved === "api-key" ? saved : "account";
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const preferredLanguage = useSettingsStore((state) => state.preferredLanguage) as DesktopLanguageCode;
  const [hotkey, setHotkey] = useState(() => localStorage.getItem("hotkey") || "CommandOrControl+Shift+Space");
  const [testText, setTestText] = useState("");
  const permissions = usePermissions();
  const systemAudio = useSystemAudioPermission();
  const { registerHotkey, isRegistering } = useHotkeyRegistration();
  const usage = useUsage();

  const stepIndex = ONBOARDING_STEPS.indexOf(step);
  const provider: DesktopLanguageProvider = mode === "account" ? "aisha" : "whisper";
  const cloudCapabilities =
    usage?.hasLoaded && !usage.isLoading && !usage.error
      ? {
          supportedLanguages: usage.supportedLanguages,
          autoDetectionSupported: usage.autoDetectionSupported,
        }
      : undefined;
  const languageOptions = useMemo(
    () => getDesktopLanguageOptions(provider, mode === "account" ? cloudCapabilities : undefined),
    [cloudCapabilities, mode, provider]
  );
  const selectedSupported = languageOptions.some((item) => item.value === preferredLanguage && !item.disabled);

  const go = useCallback((next: OnboardingStep) => {
    localStorage.setItem(ONBOARDING_STEP_KEY, next);
    setStep(next);
  }, []);

  const chooseMode = (nextMode: SetupMode) => {
    localStorage.setItem(MODE_KEY, nextMode);
    setMode(nextMode);
  };

  const setLanguage = (language: string) => {
    localStorage.setItem("preferredLanguage", language);
    useSettingsStore.setState({ preferredLanguage: language });
  };

  const finish = () => {
    const state = useSettingsStore.getState();
    if (mode === "account") {
      state.setCloudTranscriptionForAllScopes({ useLocalWhisper: false, cloudTranscriptionMode: "openwhispr" });
      localStorage.setItem("transcriptionMode", "openwhispr");
      useSettingsStore.setState({ transcriptionMode: "openwhispr" });
    } else if (mode === "local") {
      state.setCloudTranscriptionForAllScopes({ useLocalWhisper: true, cloudTranscriptionMode: "byok" });
      localStorage.setItem("transcriptionMode", "local");
      useSettingsStore.setState({ transcriptionMode: "local", useCleanupModel: false, useDictationAgent: false });
    } else {
      state.setCloudTranscriptionForAllScopes({ useLocalWhisper: false, cloudTranscriptionMode: "byok" });
      localStorage.setItem("transcriptionMode", "providers");
      useSettingsStore.setState({ transcriptionMode: "providers", useCleanupModel: false, useDictationAgent: false });
    }
    clearOnboardingProgress();
    onComplete({ openSettings: mode === "api-key" });
  };

  const canContinue =
    step === "welcome" ||
    (step === "mode" && mode !== "account") ||
    (step === "language-permissions" && selectedSupported && permissions.micPermissionGranted) ||
    step === "hotkey";

  const progress = ONBOARDING_STEPS.map((id) => ({
    title: t(`desktop.onboarding.progress.${id}`),
    icon: { welcome: Sparkles, mode: LogIn, "language-permissions": Languages, hotkey: Command, ready: CheckCircle2 }[id],
  }));

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex h-10 items-center justify-end border-b border-border px-2 [app-region:drag]">
        <div className="[app-region:no-drag]"><WindowControls /></div>
      </div>
      <div className="border-b border-border px-5 py-3"><StepProgress steps={progress} currentStep={stepIndex} /></div>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center overflow-y-auto px-6 py-7">
        {step === "welcome" && (
          <div className="space-y-5 text-center">
            <img src={logoIcon} alt="VoiceLab" className="mx-auto h-16 w-16 rounded-2xl" />
            <div><h1 className="text-2xl font-semibold">{t("desktop.onboarding.welcome.title")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("desktop.onboarding.welcome.description")}</p></div>
          </div>
        )}

        {step === "mode" && mode === "account" && !showAdvanced && (
          <AuthenticationStep
            onAuthComplete={() => go("language-permissions")}
            onContinueWithoutAccount={() => setShowAdvanced(true)}
          />
        )}

        {step === "mode" && mode === "account" && showAdvanced && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">{t("desktop.onboarding.advanced.title")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("desktop.onboarding.advanced.description")}
              </p>
            </div>
            <button onClick={() => chooseMode("local")} className="flex w-full gap-3 rounded-xl border border-border p-3.5 text-left hover:border-[#f05a4f]/40 hover:bg-[#f05a4f]/5"><HardDrive className="h-5 w-5" /><span><strong className="block text-sm">{t("desktop.onboarding.advanced.localTitle")}</strong><span className="text-xs text-muted-foreground">{t("desktop.onboarding.advanced.localDescription")}</span></span></button>
            <button onClick={() => chooseMode("api-key")} className="flex w-full gap-3 rounded-xl border border-border p-3.5 text-left hover:border-[#f05a4f]/40 hover:bg-[#f05a4f]/5"><KeyRound className="h-5 w-5" /><span><strong className="block text-sm">{t("desktop.onboarding.advanced.providerTitle")}</strong><span className="text-xs text-muted-foreground">{t("desktop.onboarding.advanced.providerDescription")}</span></span></button>
            <Button variant="ghost" className="w-full" onClick={() => setShowAdvanced(false)}>
              {t("desktop.onboarding.advanced.useCloud")}
            </Button>
          </div>
        )}

        {step === "mode" && mode && mode !== "account" && (
          <div className="space-y-5 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-muted">{mode === "local" ? <HardDrive /> : <KeyRound />}</div><div><h2 className="text-xl font-semibold">{t(mode === "local" ? "desktop.onboarding.mode.localTitle" : "desktop.onboarding.mode.providerTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t(mode === "local" ? "desktop.onboarding.mode.localDescription" : "desktop.onboarding.mode.providerDescription")}</p></div></div>
        )}

        {step === "language-permissions" && (
          <div className="space-y-5">
            <div><h2 className="text-xl font-semibold">{t("desktop.onboarding.language.title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("desktop.onboarding.language.description")}</p></div>
            {mode === "account" && usage?.isLoading && (
              <p role="status" className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {t("desktop.onboarding.language.loadingCapabilities")}
              </p>
            )}
            {mode === "account" && usage?.error && (
              <p role="status" className="rounded-lg bg-amber-500/8 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
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
            {!permissions.micPermissionGranted && <p className="text-xs text-muted-foreground">{t("desktop.onboarding.language.microphoneRequired")}</p>}
          </div>
        )}

        {step === "hotkey" && (
          <div className="space-y-5">
            <div><h2 className="text-xl font-semibold">{t("desktop.onboarding.hotkey.title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("desktop.onboarding.hotkey.description")}</p></div>
            <HotkeyInput value={hotkey} disabled={isRegistering} variant="hero" onChange={async (value) => { if (await registerHotkey(value)) { setHotkey(value); localStorage.setItem("hotkey", value); } }} />
            <Textarea value={testText} onChange={(event) => setTestText(event.target.value)} placeholder={t("desktop.onboarding.hotkey.placeholder")} className="min-h-24" autoFocus />
          </div>
        )}

        {step === "ready" && (
          <div className="space-y-5 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10"><CheckCircle2 className="h-7 w-7 text-emerald-500" /></div><div><h2 className="text-2xl font-semibold">{t("desktop.onboarding.ready.title")}</h2><p className="mt-2 text-sm text-muted-foreground">{t(mode === "account" ? "desktop.onboarding.ready.account" : mode === "local" ? "desktop.onboarding.ready.local" : "desktop.onboarding.ready.provider")}</p></div></div>
        )}
      </main>
      <footer className="flex items-center justify-between border-t border-border px-6 py-4">
        <Button variant="ghost" disabled={stepIndex === 0} onClick={() => go(ONBOARDING_STEPS[Math.max(0, stepIndex - 1)])}>{t("common.back")}</Button>
        {step === "ready" ? <Button onClick={finish}>{t("desktop.onboarding.ready.start")}</Button> : step === "mode" && mode === "account" ? <span /> : <Button disabled={!canContinue} onClick={() => go(ONBOARDING_STEPS[Math.min(ONBOARDING_STEPS.length - 1, stepIndex + 1)])}>{t("common.continue")}</Button>}
      </footer>
    </div>
  );
}
