import React, { useState, useCallback, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  RefreshCw,
  Download,
  Mic,
  Shield,
  FolderOpen,
  LogOut,
  UserCircle,
  Sun,
  Moon,
  Monitor,
  Cloud,
  Network,
  Sparkles,
  AlertTriangle,
  Loader2,
  Check,
  Mail,
  CircleCheck,
  CircleX,
  RotateCw,
  BookOpen,
  Copy,
  Trash2,
  Info,
  MessageSquare,
  FileAudio,
  Wand2,
  Upload,
  Languages,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { AUTH_URL, signOut, deleteAccount } from "../lib/auth";
import MicPermissionWarning from "./ui/MicPermissionWarning";
import MicrophoneSettings from "./ui/MicrophoneSettings";
import PermissionCard from "./ui/PermissionCard";
import PasteToolsInfo from "./ui/PasteToolsInfo";
import NixOsPasteInfo from "./ui/NixOsPasteInfo";
import {
  ConfirmDialog,
  AlertDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { useSettings } from "../hooks/useSettings";
import { useDialogs } from "../hooks/useDialogs";
import { usePermissions } from "../hooks/usePermissions";
import { useSystemAudioPermission } from "../hooks/useSystemAudioPermission";
import { useClipboard } from "../hooks/useClipboard";
import { useUpdater } from "../hooks/useUpdater";

import PromptStudio from "./ui/PromptStudio";
import { ProviderTabs } from "./ui/ProviderTabs";
import { HotkeyListInput } from "./ui/HotkeyListInput";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { useHotkeyModeInfo } from "../hooks/useHotkeyModeInfo";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { validateHotkeyForSlot } from "../utils/hotkeyValidation";
import { getPlatform, getCachedPlatform } from "../utils/platform";
import { formatHotkeyLabel } from "../utils/hotkeys";
import { ActivationModeSelector } from "./ui/ActivationModeSelector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import LinuxPttSetupInfo from "./ui/LinuxPttSetupInfo";
import { Toggle } from "./ui/toggle";
import DeveloperSection from "./DeveloperSection";
import ChatAgentSettings from "./settings/ChatAgentSettings";
import DictationAgentSettings from "./settings/DictationAgentSettings";
import DictationTranslationSettings from "./settings/DictationTranslationSettings";
import InferenceConfigEditor from "./settings/InferenceConfigEditor";
import { MeetingTranscriptionPanel } from "./settings/MeetingSettings";
import { UploadTranscriptionPanel } from "./settings/UploadSettings";
import LanguageSelector from "./ui/LanguageSelector";
import type { LanguageOption } from "../config/desktopLanguageOptions";
import { Skeleton } from "./ui/skeleton";
import { Progress } from "./ui/progress";
import { useToast } from "./ui/useToast";
import { useTheme } from "../hooks/useTheme";
import type { GpuDevice, InferenceMode } from "../types/electron";
import logger from "../utils/logger";
import { SettingsRow } from "./ui/SettingsSection";
import { useSettingsLayout } from "./ui/useSettingsLayout";
import UsageDisplay from "./UsageDisplay";
import { cn } from "./lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { formatBytes } from "../utils/formatBytes";
import { useSettingsStore } from "../stores/settingsStore";
import { canManageSystemAudioInApp } from "../utils/systemAudioAccess";
import WorkspaceSection from "./settings/WorkspaceSection";
import { WORKSPACES_ENABLED } from "../lib/features";

const formatAmount = (cents: number, currency: string) =>
  (cents / 100).toLocaleString(undefined, { style: "currency", currency });

export type SettingsSectionType =
  | "account"
  | "plansBilling"
  | "workspace"
  | "general"
  | "hotkeys"
  | "speechToText"
  | "llms"
  | "privacyData"
  | "system";

interface SettingsPageProps {
  activeSection?: SettingsSectionType;
  onNavigateToSection?: (section: SettingsSectionType) => void;
  /** When a legacy section ID was used (e.g. `meetings`), land on the matching sub-tab. */
  initialSubTab?: string;
}

const UI_LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "uz", label: "Oʻzbekcha", flag: "🇺🇿" },
  { value: "en", label: "English", flag: "🇺🇸" },
  { value: "es", label: "Español", flag: "🇪🇸" },
  { value: "fr", label: "Français", flag: "🇫🇷" },
  { value: "de", label: "Deutsch", flag: "🇩🇪" },
  { value: "pt", label: "Português", flag: "🇵🇹" },
  { value: "it", label: "Italiano", flag: "🇮🇹" },
  { value: "ru", label: "Русский", flag: "🇷🇺" },
  { value: "ja", label: "日本語", flag: "🇯🇵" },
  { value: "zh-CN", label: "简体中文", flag: "🇨🇳" },
  { value: "zh-TW", label: "繁體中文", flag: "🇹🇼" },
];

const noop = () => {};

function SettingsPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`divide-y divide-border/60 border-y border-border/60 bg-transparent ${className}`}
    >
      {children}
    </div>
  );
}

function SettingsPanelRow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { isCompact } = useSettingsLayout();

  return <div className={`${isCompact ? "py-3" : "min-h-20 py-4"} ${className}`}>{children}</div>;
}

function SectionHeader({
  title,
  description,
  note,
}: {
  title: string;
  description?: string;
  note?: string;
}) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold tracking-[-0.015em] text-foreground">{title}</h3>
      {description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>}
      {note && <p className="mt-1 text-sm leading-6 text-muted-foreground">{note}</p>}
    </div>
  );
}

function TranscriptionSection({
  showTranscriptionPreview,
  setShowTranscriptionPreview,
}: {
  showTranscriptionPreview: boolean;
  setShowTranscriptionPreview: (value: boolean) => void;
}) {
  const { t } = useTranslation();

  // VoiceLab Cloud is the only desktop speech transcription route.
  return (
    <div className="space-y-4">
      <SettingsPanel>
        <SettingsPanelRow>
          <div className="flex items-start gap-3 w-full">
            <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Cloud className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">
                  {t("settingsPage.transcription.modes.openwhispr")}
                </p>
                <Badge variant="success">VoiceLab</Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("settingsPage.transcription.modes.openwhisprDesc")}
              </p>
            </div>
          </div>
        </SettingsPanelRow>
      </SettingsPanel>

      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.transcription.transcriptionPreview")}
            description={t("settingsPage.transcription.transcriptionPreviewDescription")}
          >
            <Toggle checked={showTranscriptionPreview} onChange={setShowTranscriptionPreview} />
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}

interface AiModelsSectionProps {
  useCleanupModel: boolean;
  setUseCleanupModel: (value: boolean) => void;
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive" | "success";
    duration?: number;
  }) => void;
}

const CLEANUP_MODE_TOAST_KEY: Record<InferenceMode, string> = {
  openwhispr: "switchedCloud",
  voicelab: "switchedCloud",
  providers: "switchedProviders",
  local: "switchedLocal",
  "self-hosted": "switchedSelfHosted",
  enterprise: "switchedEnterprise",
};

function NoteFormattingSettings() {
  const { t } = useTranslation();
  const autoGenerateNoteTitle = useSettingsStore((s) => s.autoGenerateNoteTitle);
  const setAutoGenerateNoteTitle = useSettingsStore((s) => s.setAutoGenerateNoteTitle);

  return (
    <div className="space-y-4">
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.noteFormatting.autoGenerateTitle")}
            description={t("settingsPage.noteFormatting.autoGenerateTitleDescription")}
          >
            <Toggle checked={autoGenerateNoteTitle} onChange={setAutoGenerateNoteTitle} />
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>
      <InferenceConfigEditor scope="noteFormatting" />
    </div>
  );
}

function AiModelsSection({ useCleanupModel, setUseCleanupModel, toast }: AiModelsSectionProps) {
  const { t } = useTranslation();

  const handleCleanupModeChange = (mode: InferenceMode) => {
    const toastKey = CLEANUP_MODE_TOAST_KEY[mode];
    toast({
      title: t(`settingsPage.aiModels.toasts.${toastKey}.title`),
      description: t(`settingsPage.aiModels.toasts.${toastKey}.description`),
      variant: "success",
      duration: 3000,
    });
  };

  return (
    <div className="space-y-4">
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.aiModels.enableTextCleanup")}
            description={t("settingsPage.aiModels.enableTextCleanupDescription")}
          >
            <Toggle checked={useCleanupModel} onChange={setUseCleanupModel} />
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>

      {useCleanupModel && (
        <>
          <InferenceConfigEditor scope="dictationCleanup" onModeChange={handleCleanupModeChange} />
          <GpuDeviceSelector purpose="intelligence" />
        </>
      )}
    </div>
  );
}

type SpeechTab = "dictation" | "noteRecording" | "upload";
type LlmTab =
  | "dictationCleanup"
  | "dictationAgent"
  | "dictationTranslation"
  | "noteFormatting"
  | "chatIntelligence";

const SPEECH_TABS: SpeechTab[] = ["dictation", "noteRecording", "upload"];
const LLM_TABS: LlmTab[] = [
  "dictationCleanup",
  "dictationAgent",
  "dictationTranslation",
  "noteFormatting",
  "chatIntelligence",
];

function useSubTab<T extends string>(storageKey: string, options: readonly T[], initial?: T) {
  const [tab, setTab] = useLocalStorage<T>(storageKey, initial ?? options[0]);
  useEffect(() => {
    if (initial && initial !== tab) setTab(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  const safeTab = options.includes(tab) ? tab : options[0];
  return [safeTab, setTab] as const;
}

function VADLabelWithInfo({ label, description }: { label: string; description: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
      <span>{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground transition-colors"
            aria-label={label}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="max-w-sm p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TabPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <div className={active ? undefined : "hidden"}>{children}</div>;
}

function SpeechToTextTabs({
  initialTab,
  renderDictation,
  renderNoteRecording,
  renderUpload,
}: {
  initialTab?: SpeechTab;
  renderDictation: () => React.ReactNode;
  renderNoteRecording: () => React.ReactNode;
  renderUpload: () => React.ReactNode;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useSubTab<SpeechTab>("settings.speechToTextTab", SPEECH_TABS, initialTab);

  const subTabs = [
    { id: "dictation", name: t("settingsPage.speechToText.tabs.dictation") },
    { id: "noteRecording", name: t("settingsPage.speechToText.tabs.noteRecording") },
    { id: "upload", name: t("settingsPage.speechToText.tabs.upload") },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t("settingsPage.speechToText.title")}
        description={t("settingsPage.speechToText.description")}
      />
      <ProviderTabs
        providers={subTabs}
        selectedId={tab}
        onSelect={(id) => setTab(id as SpeechTab)}
        renderIcon={(id) =>
          id === "dictation" ? (
            <Mic className="w-3.5 h-3.5" />
          ) : id === "upload" ? (
            <Upload className="w-3.5 h-3.5" />
          ) : (
            <FileAudio className="w-3.5 h-3.5" />
          )
        }
      />
      <TabPanel active={tab === "dictation"}>{renderDictation()}</TabPanel>
      <TabPanel active={tab === "noteRecording"}>{renderNoteRecording()}</TabPanel>
      <TabPanel active={tab === "upload"}>{renderUpload()}</TabPanel>
    </div>
  );
}

function LlmsTabs({
  initialTab,
  renderDictationCleanup,
  renderDictationAgent,
  renderDictationTranslation,
  renderNoteFormatting,
  renderChatIntelligence,
}: {
  initialTab?: LlmTab;
  renderDictationCleanup: () => React.ReactNode;
  renderDictationAgent: () => React.ReactNode;
  renderDictationTranslation: () => React.ReactNode;
  renderNoteFormatting: () => React.ReactNode;
  renderChatIntelligence: () => React.ReactNode;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useSubTab<LlmTab>("settings.llmsTab", LLM_TABS, initialTab);

  const subTabs = [
    { id: "dictationCleanup", name: t("settingsPage.llms.tabs.dictationCleanup") },
    { id: "dictationAgent", name: t("settingsPage.llms.tabs.dictationAgent") },
    { id: "dictationTranslation", name: t("settingsPage.llms.tabs.dictationTranslation") },
    { id: "noteFormatting", name: t("settingsPage.llms.tabs.noteFormatting") },
    { id: "chatIntelligence", name: t("settingsPage.llms.tabs.chatIntelligence") },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t("settingsPage.llms.title")}
        description={t("settingsPage.llms.description")}
      />
      <ProviderTabs
        providers={subTabs}
        selectedId={tab}
        onSelect={(id) => setTab(id as LlmTab)}
        renderIcon={(id) => {
          if (id === "dictationCleanup") return <Wand2 className="w-3.5 h-3.5" />;
          if (id === "dictationAgent") return <Sparkles className="w-3.5 h-3.5" />;
          if (id === "dictationTranslation") return <Languages className="w-3.5 h-3.5" />;
          if (id === "noteFormatting") return <BookOpen className="w-3.5 h-3.5" />;
          return <MessageSquare className="w-3.5 h-3.5" />;
        }}
      />
      <TabPanel active={tab === "dictationCleanup"}>{renderDictationCleanup()}</TabPanel>
      <TabPanel active={tab === "dictationAgent"}>{renderDictationAgent()}</TabPanel>
      <TabPanel active={tab === "dictationTranslation"}>{renderDictationTranslation()}</TabPanel>
      <TabPanel active={tab === "noteFormatting"}>{renderNoteFormatting()}</TabPanel>
      <TabPanel active={tab === "chatIntelligence"}>{renderChatIntelligence()}</TabPanel>
    </div>
  );
}

function GpuDeviceSelector({ purpose }: { purpose: "intelligence" }) {
  const { t } = useTranslation();
  const [gpus, setGpus] = useState<GpuDevice[]>([]);
  const [selectedUuid, setSelectedUuid] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      window.electronAPI?.listGpus?.() ?? Promise.resolve([]),
      window.electronAPI?.getGpuDeviceIndex?.(purpose) ?? Promise.resolve(""),
    ])
      .then(([gpuList, savedUuid]) => {
        setGpus(gpuList);
        setSelectedUuid(savedUuid || gpuList[0]?.uuid || "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [purpose]);

  if (!loaded || gpus.length < 2) return null;

  return (
    <div className="border-t border-border/40 pt-4 mt-4">
      <SectionHeader
        title={t(`settingsPage.${purpose}.gpuDevice.title`)}
        description={t(`settingsPage.${purpose}.gpuDevice.description`)}
      />
      <SettingsPanel>
        <SettingsPanelRow>
          <div className="relative w-full">
            <select
              value={selectedUuid}
              onChange={async (e) => {
                const uuid = e.target.value;
                setSelectedUuid(uuid);
                await window.electronAPI?.setGpuDeviceIndex?.(purpose, uuid);
              }}
              className="w-full appearance-none rounded-md border border-border bg-background px-3 pr-10 py-2 text-sm"
            >
              {gpus.map((gpu) => (
                <option key={gpu.uuid} value={gpu.uuid}>
                  GPU {gpu.index}: {gpu.name} ({Math.round(gpu.vramMb / 1024)}GB)
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}

export default function SettingsPage({
  activeSection = "general",
  onNavigateToSection,
  initialSubTab,
}: SettingsPageProps) {
  const { isCompact } = useSettingsLayout();
  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const {
    uiLanguage,
    preferredLanguage,
    useCleanupModel,
    dictationKey,
    activationMode,
    setActivationMode,
    preferBuiltInMic,
    selectedMicDeviceId,
    selectedMicDeviceLabel,
    setPreferBuiltInMic,
    setSelectedMicDevice,
    setUiLanguage,
    setUseCleanupModel,
    setDictationKey,
    meetingKey,
    setMeetingKey,
    meetingHotkeyLayoutMode,
    setMeetingHotkeyLayoutMode,
    autoLearnCorrections,
    setAutoLearnCorrections,
    updateTranscriptionSettings,
    updateCleanupSettings,
    notificationsEnabled,
    setNotificationsEnabled,
    notifyMeetingDetection,
    setNotifyMeetingDetection,
    notifyCalendarReminders,
    setNotifyCalendarReminders,
    notifyUpdates,
    setNotifyUpdates,
    audioCuesEnabled,
    setAudioCuesEnabled,
    pauseMediaOnDictation,
    setPauseMediaOnDictation,
    showTranscriptionPreview,
    setShowTranscriptionPreview,
    autoPasteEnabled,
    setAutoPasteEnabled,
    keepTranscriptionInClipboard,
    setKeepTranscriptionInClipboard,
    floatingIconAutoHide,
    setFloatingIconAutoHide,
    startMinimized,
    setStartMinimized,
    panelStartPosition,
    setPanelStartPosition,
    telemetryEnabled,
    setTelemetryEnabled,
    audioRetentionDays,
    setAudioRetentionDays,
    dataRetentionEnabled,
    setDataRetentionEnabled,
    saveDiscardedTranscriptions,
    setSaveDiscardedTranscriptions,
    customDictionary,
    setCustomDictionary,
    noteFilesEnabled,
    setNoteFilesEnabled,
    noteFilesPath,
    setNoteFilesPath,
    dictationSileroEnabled,
    setDictationSileroEnabled,
    noteRecordingSileroEnabled,
    setNoteRecordingSileroEnabled,
    meetingSileroEnabled,
    setMeetingSileroEnabled,
    whisperVadThreshold,
    setWhisperVadThreshold,
    whisperVadMinSpeechDurationMs,
    setWhisperVadMinSpeechDurationMs,
    whisperVadMinSilenceDurationMs,
    setWhisperVadMinSilenceDurationMs,
    whisperVadMaxSpeechDurationS,
    setWhisperVadMaxSpeechDurationS,
    whisperVadSpeechPadMs,
    setWhisperVadSpeechPadMs,
    whisperVadSamplesOverlap,
    setWhisperVadSamplesOverlap,
  } = useSettings();

  const chatAgentKey = useSettingsStore((s) => s.chatAgentKey);
  const setChatAgentKey = useSettingsStore((s) => s.setChatAgentKey);
  const voiceAgentKey = useSettingsStore((s) => s.voiceAgentKey);
  const setVoiceAgentKey = useSettingsStore((s) => s.setVoiceAgentKey);
  const translationKey = useSettingsStore((s) => s.translationKey);
  const setTranslationKey = useSettingsStore((s) => s.setTranslationKey);

  const { t } = useTranslation();
  const { toast } = useToast();

  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [isRemovingModels, setIsRemovingModels] = useState(false);
  const {
    status: updateStatus,
    info: updateInfo,
    downloadProgress: updateDownloadProgress,
    isChecking: checkingForUpdates,
    isDownloading: downloadingUpdate,
    isInstalling: installInitiated,
    checkForUpdates,
    downloadUpdate,
    installUpdate: installUpdateAction,
    getAppVersion,
    error: updateError,
    clearError: clearUpdateError,
  } = useUpdater();

  const isUpdateAvailable =
    !updateStatus.isDevelopment && (updateStatus.updateAvailable || updateStatus.updateDownloaded);

  const permissionsHook = usePermissions(showAlertDialog);
  const systemAudio = useSystemAudioPermission();
  useClipboard(showAlertDialog);
  const [audioStorageUsage, setAudioStorageUsage] = useState<{
    fileCount: number;
    totalBytes: number;
  }>({ fileCount: 0, totalBytes: 0 });

  useEffect(() => {
    if (activeSection !== "privacyData") return;
    window.electronAPI
      ?.getAudioStorageUsage?.()
      .then((usage: { fileCount: number; totalBytes: number }) => {
        if (usage) setAudioStorageUsage(usage);
      })
      .catch(() => {});
  }, [activeSection]);

  // Lazy keep-alive: mount AI sections only after the user has visited them once,
  // then keep them mounted so model-download progress and IPC listeners survive
  // section switches. The setState-during-render pattern flips the flag in the
  // same commit as the section change, so there's no blank frame on first visit.
  const [hasMountedSpeechToText, setHasMountedSpeechToText] = useState(
    activeSection === "speechToText"
  );
  const [hasMountedLlms, setHasMountedLlms] = useState(activeSection === "llms");
  if (activeSection === "speechToText" && !hasMountedSpeechToText) {
    setHasMountedSpeechToText(true);
  }
  if (activeSection === "llms" && !hasMountedLlms) {
    setHasMountedLlms(true);
  }

  const handleClearAllAudio = async () => {
    if (!window.electronAPI?.deleteAllAudio) return;
    try {
      await window.electronAPI.deleteAllAudio();
      setAudioStorageUsage({ fileCount: 0, totalBytes: 0 });
      toast({ title: t("settingsPage.privacy.clearAllAudio"), variant: "default" });
    } catch {
      // silent fail
    }
  };

  // ydotool status for Wayland paste diagnostics
  const [ydotoolStatus, setYdotoolStatus] = useState<{
    isLinux: boolean;
    isWayland: boolean;
    hasYdotool: boolean;
    hasYdotoold: boolean;
    daemonRunning: boolean;
    hasService: boolean;
    hasUinput: boolean;
    hasUdevRule: boolean;
    hasGroup: boolean;
    allGood: boolean;
    isKde?: boolean;
    hasXclip?: boolean;
    hasXsel?: boolean;
    isNixOS?: boolean;
  } | null>(null);
  const [ydotoolGuideKey, setYdotoolGuideKey] = useState<string | null>(null);

  const refreshYdotoolStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI?.getYdotoolStatus?.();
      if (status) setYdotoolStatus(status);
    } catch {}
  }, []);

  useEffect(() => {
    refreshYdotoolStatus();
  }, [refreshYdotoolStatus]);

  const { theme, setTheme } = useTheme();

  const installTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { registerHotkey, isRegistering: isHotkeyRegistering } = useHotkeyRegistration({
    onSuccess: (registeredHotkey) => {
      setDictationKey(registeredHotkey);
    },
    showSuccessToast: false,
    showErrorToast: true,
    showAlert: showAlertDialog,
  });

  const meetingRegisterFn = useCallback(async (hotkey: string) => {
    const result = await window.electronAPI?.registerMeetingHotkey?.(hotkey);
    return result ?? { success: false, message: "Electron API unavailable" };
  }, []);

  const { registerHotkey: registerMeetingHotkey, isRegistering: isMeetingHotkeyRegistering } =
    useHotkeyRegistration({
      onSuccess: (registeredHotkey) => {
        setMeetingKey(registeredHotkey);
      },
      showSuccessToast: false,
      showErrorToast: true,
      showAlert: showAlertDialog,
      registerFn: meetingRegisterFn,
    });

  // Agent hotkey setters resolve to false when main-process registration fails;
  // surface it and return the result so HotkeyListInput rolls the row back.
  const [isAgentHotkeyCommitting, setIsAgentHotkeyCommitting] = useState(false);
  const commitAgentHotkey = useCallback(
    async (setter: (key: string) => Promise<boolean>, key: string) => {
      setIsAgentHotkeyCommitting(true);
      try {
        const ok = await setter(key);
        if (!ok) {
          showAlertDialog({
            title: t("hooks.hotkeyRegistration.titles.notRegistered"),
            description: t("hooks.hotkeyRegistration.errors.failedToRegister"),
          });
        }
        return ok;
      } finally {
        setIsAgentHotkeyCommitting(false);
      }
    },
    [showAlertDialog, t]
  );

  const validateDictationHotkey = useCallback(
    (hotkey: string) =>
      validateHotkeyForSlot(
        hotkey,
        {
          "settingsPage.general.meetingHotkey.title": meetingKey,
          "agentMode.settings.hotkey": chatAgentKey,
          "settingsPage.general.voiceAgentHotkey.title": voiceAgentKey,
          "settingsPage.general.translationHotkey.title": translationKey,
        },
        t
      ),
    [meetingKey, chatAgentKey, voiceAgentKey, translationKey, t]
  );

  const validateMeetingHotkey = useCallback(
    (hotkey: string) =>
      validateHotkeyForSlot(
        hotkey,
        {
          "settingsPage.general.hotkey.title": dictationKey,
          "agentMode.settings.hotkey": chatAgentKey,
          "settingsPage.general.voiceAgentHotkey.title": voiceAgentKey,
          "settingsPage.general.translationHotkey.title": translationKey,
        },
        t
      ),
    [dictationKey, chatAgentKey, voiceAgentKey, translationKey, t]
  );

  const validateChatAgentHotkey = useCallback(
    (hotkey: string) =>
      validateHotkeyForSlot(
        hotkey,
        {
          "settingsPage.general.hotkey.title": dictationKey,
          "settingsPage.general.meetingHotkey.title": meetingKey,
          "settingsPage.general.voiceAgentHotkey.title": voiceAgentKey,
          "settingsPage.general.translationHotkey.title": translationKey,
        },
        t
      ),
    [dictationKey, meetingKey, voiceAgentKey, translationKey, t]
  );

  const validateVoiceAgentHotkey = useCallback(
    (hotkey: string) =>
      validateHotkeyForSlot(
        hotkey,
        {
          "settingsPage.general.hotkey.title": dictationKey,
          "settingsPage.general.meetingHotkey.title": meetingKey,
          "agentMode.settings.hotkey": chatAgentKey,
          "settingsPage.general.translationHotkey.title": translationKey,
        },
        t
      ),
    [dictationKey, meetingKey, chatAgentKey, translationKey, t]
  );

  const validateTranslationHotkey = useCallback(
    (hotkey: string) =>
      validateHotkeyForSlot(
        hotkey,
        {
          "settingsPage.general.hotkey.title": dictationKey,
          "settingsPage.general.meetingHotkey.title": meetingKey,
          "agentMode.settings.hotkey": chatAgentKey,
          "settingsPage.general.voiceAgentHotkey.title": voiceAgentKey,
        },
        t
      ),
    [dictationKey, meetingKey, chatAgentKey, voiceAgentKey, t]
  );

  const { isUsingNativeShortcut, isUsingHyprland, hyprlandConfigStatus, supportsPushToTalk } =
    useHotkeyModeInfo("settings");
  const [effectiveDefaultHotkey, setEffectiveDefaultHotkey] = useState<string | null>(null);
  const [linuxPttAvailable, setLinuxPttAvailable] = useState(true);

  const platform = getCachedPlatform();

  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [autoStartLoading, setAutoStartLoading] = useState(true);

  useEffect(() => {
    if (platform === "linux") {
      setAutoStartLoading(false);
      return;
    }
    const loadAutoStart = async () => {
      if (window.electronAPI?.getAutoStartEnabled) {
        try {
          const enabled = await window.electronAPI.getAutoStartEnabled();
          setAutoStartEnabled(enabled);
        } catch (error) {
          logger.error("Failed to get auto-start status", error, "settings");
        }
      }
      setAutoStartLoading(false);
    };
    loadAutoStart();
  }, [platform]);

  useEffect(() => {
    window.electronAPI?.syncNotificationPreferences?.({
      notificationsEnabled,
      notifyMeetingDetection,
      notifyCalendarReminders,
      notifyUpdates,
    });
  }, [notificationsEnabled, notifyMeetingDetection, notifyCalendarReminders, notifyUpdates]);

  const handleAutoStartChange = async (enabled: boolean) => {
    if (window.electronAPI?.setAutoStartEnabled) {
      try {
        setAutoStartLoading(true);
        const result = await window.electronAPI.setAutoStartEnabled(enabled);
        if (result.success) {
          setAutoStartEnabled(enabled);
        }
      } catch (error) {
        logger.error("Failed to set auto-start", error, "settings");
      } finally {
        setAutoStartLoading(false);
      }
    }
  };

  const [noteFilesDefaultPath, setNoteFilesDefaultPath] = useState("");
  const [noteFilesRebuilding, setNoteFilesRebuilding] = useState(false);

  useEffect(() => {
    if (!noteFilesEnabled) return;
    window.electronAPI?.noteFilesGetDefaultPath?.().then((p) => {
      if (p) setNoteFilesDefaultPath(p);
    });
  }, [noteFilesEnabled]);

  const handleNoteFilesToggle = useCallback(
    async (enabled: boolean) => {
      setNoteFilesEnabled(enabled);
      await window.electronAPI?.noteFilesSetEnabled?.(enabled, noteFilesPath || undefined);
    },
    [setNoteFilesEnabled, noteFilesPath]
  );

  const handleNoteFilesChangePath = useCallback(async () => {
    const result = await window.electronAPI?.noteFilesPickFolder?.();
    if (result?.canceled || !result?.path) return;
    setNoteFilesPath(result.path);
    await window.electronAPI?.noteFilesSetPath?.(result.path);
  }, [setNoteFilesPath]);

  const handleNoteFilesRebuild = useCallback(async () => {
    setNoteFilesRebuilding(true);
    try {
      const result = await window.electronAPI?.noteFilesRebuild?.();
      if (result && !result.success) {
        toast({
          title: t("settings.noteFiles.rebuildError.title"),
          description: result.error || t("settings.noteFiles.rebuildError.description"),
          variant: "destructive",
        });
      }
    } finally {
      setNoteFilesRebuilding(false);
    }
  }, [toast, t]);

  useEffect(() => {
    let mounted = true;

    const timer = setTimeout(async () => {
      if (!mounted) return;

      const version = await getAppVersion();
      if (version && mounted) setCurrentVersion(version);
    }, 100);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [getAppVersion]);

  useEffect(() => {
    if (isUsingNativeShortcut && !supportsPushToTalk) {
      setActivationMode("tap");
    }
  }, [isUsingNativeShortcut, supportsPushToTalk, setActivationMode]);

  useEffect(() => {
    const loadEffectiveDefaultHotkey = async () => {
      try {
        const key = await window.electronAPI?.getEffectiveDefaultHotkey?.();
        if (key) setEffectiveDefaultHotkey(key);
      } catch (error) {
        logger.error("Failed to get effective default hotkey", error, "settings");
      }
    };
    loadEffectiveDefaultHotkey();
  }, []);

  useEffect(() => {
    const cleanup = window.electronAPI?.onLinuxPttPermissionDenied?.(() => {
      setLinuxPttAvailable(false);
      toast({
        title: t("settingsPage.general.hotkey.linuxPttPermissionTitle"),
        description: t("settingsPage.general.hotkey.linuxPttPermissionDescription"),
        variant: "destructive",
        duration: 15000,
      });
      setActivationMode("tap");
    });
    return () => cleanup?.();
  }, [toast, t, setActivationMode]);

  useEffect(() => {
    if (updateError) {
      showAlertDialog({
        title: t("settingsPage.general.updates.dialogs.updateError.title"),
        description: t("settingsPage.general.updates.dialogs.updateError.description"),
      });
      clearUpdateError();
    }
  }, [updateError, showAlertDialog, clearUpdateError, t]);

  useEffect(() => {
    if (installInitiated) {
      if (installTimeoutRef.current) {
        clearTimeout(installTimeoutRef.current);
      }
      installTimeoutRef.current = setTimeout(() => {
        showAlertDialog({
          title: t("settingsPage.general.updates.dialogs.almostThere.title"),
          description: t("settingsPage.general.updates.dialogs.almostThere.description"),
        });
      }, 10000);
    } else if (installTimeoutRef.current) {
      clearTimeout(installTimeoutRef.current);
      installTimeoutRef.current = null;
    }

    return () => {
      if (installTimeoutRef.current) {
        clearTimeout(installTimeoutRef.current);
        installTimeoutRef.current = null;
      }
    };
  }, [installInitiated, showAlertDialog, t]);

  const resetAccessibilityPermissions = () => {
    const message = t("settingsPage.permissions.resetAccessibility.description");

    showConfirmDialog({
      title: t("settingsPage.permissions.resetAccessibility.title"),
      description: message,
      onConfirm: () => {
        permissionsHook.requestAccessibilityPermission();
      },
    });
  };

  const handleRemoveModels = useCallback(() => {
    if (isRemovingModels) return;

    showConfirmDialog({
      title: t("settingsPage.developer.removeModels.title"),
      description: t("settingsPage.developer.removeModels.description"),
      confirmText: t("settingsPage.developer.removeModels.confirmText"),
      variant: "destructive",
      onConfirm: async () => {
        setIsRemovingModels(true);
        try {
          const results = await Promise.allSettled([window.electronAPI?.modelDeleteAll?.()]);

          const anyFailed = results.some(
            (r) =>
              r.status === "rejected" || (r.status === "fulfilled" && r.value && !r.value.success)
          );

          if (anyFailed) {
            showAlertDialog({
              title: t("settingsPage.developer.removeModels.failedTitle"),
              description: t("settingsPage.developer.removeModels.failedDescription"),
            });
          } else {
            window.dispatchEvent(new Event("openwhispr-models-cleared"));
            showAlertDialog({
              title: t("settingsPage.developer.removeModels.successTitle"),
              description: t("settingsPage.developer.removeModels.successDescription"),
            });
          }
        } catch {
          showAlertDialog({
            title: t("settingsPage.developer.removeModels.failedTitle"),
            description: t("settingsPage.developer.removeModels.failedDescriptionShort"),
          });
        } finally {
          setIsRemovingModels(false);
        }
      },
    });
  }, [isRemovingModels, showConfirmDialog, showAlertDialog, t]);

  const { isSignedIn, isLoaded, user } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isOpeningBilling, setIsOpeningBilling] = useState(false);
  const startOnboarding = useCallback(() => {
    localStorage.setItem("pendingCloudMigration", "true");
    localStorage.setItem("onboardingCurrentStep", "0");
    localStorage.removeItem("onboardingCompleted");
    window.location.reload();
  }, []);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      window.location.reload();
    } catch (error) {
      logger.error("Sign out failed", error, "auth");
      showAlertDialog({
        title: t("settingsPage.account.signOut.failedTitle"),
        description: t("settingsPage.account.signOut.failedDescription"),
      });
    } finally {
      setIsSigningOut(false);
    }
  }, [showAlertDialog, t]);

  const handleDeleteAccount = useCallback(() => {
    showConfirmDialog({
      title: t("settingsPage.account.deleteAccount.title"),
      description: t("settingsPage.account.deleteAccount.description"),
      onConfirm: async () => {
        setIsDeletingAccount(true);
        try {
          // Best-effort cloud cleanup (needs session cookies before sign-out)
          try {
            const { NotesService } = await import("../services/NotesService");
            await NotesService.deleteAll();
          } catch {}

          const result = await deleteAccount();
          if (result.error) {
            logger.error("Server account deletion failed", result.error, "auth");
          }

          try {
            await signOut();
          } catch {}
          await window.electronAPI?.cleanupApp();

          showAlertDialog({
            title: t("settingsPage.account.deleteAccount.successTitle"),
            description: t("settingsPage.account.deleteAccount.successDescription"),
          });
          setTimeout(() => window.location.reload(), 1000);
        } catch (error) {
          logger.error("Account deletion failed", error, "auth");
          showAlertDialog({
            title: t("settingsPage.account.deleteAccount.failedTitle"),
            description: t("settingsPage.account.deleteAccount.failedDescription"),
          });
        } finally {
          setIsDeletingAccount(false);
        }
      },
      variant: "destructive",
      confirmText: t("settingsPage.account.deleteAccount.confirmText"),
    });
  }, [showConfirmDialog, showAlertDialog, t]);

  const renderWhisperVadSettings = () => (
    <div>
      <SectionHeader
        title={t("settingsPage.transcription.vad.title")}
        description={t("settingsPage.transcription.vad.description")}
      />
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.transcription.vad.toggles.dictation.title")}
            description={t("settingsPage.transcription.vad.toggles.dictation.description")}
          >
            <Toggle checked={dictationSileroEnabled} onChange={setDictationSileroEnabled} />
          </SettingsRow>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.transcription.vad.toggles.noteRecording.title")}
            description={t("settingsPage.transcription.vad.toggles.noteRecording.description")}
          >
            <Toggle checked={noteRecordingSileroEnabled} onChange={setNoteRecordingSileroEnabled} />
          </SettingsRow>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.transcription.vad.toggles.meeting.title")}
            description={t("settingsPage.transcription.vad.toggles.meeting.description")}
          >
            <Toggle checked={meetingSileroEnabled} onChange={setMeetingSileroEnabled} />
          </SettingsRow>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
            <div className="space-y-1.5">
              <VADLabelWithInfo
                label={t("settingsPage.transcription.vad.fields.threshold.label")}
                description={t("settingsPage.transcription.vad.fields.threshold.info")}
              />
              <Input
                type="number"
                step="0.01"
                min="0.1"
                max="0.95"
                value={whisperVadThreshold}
                onChange={(e) => setWhisperVadThreshold(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <VADLabelWithInfo
                label={t("settingsPage.transcription.vad.fields.minSpeechDurationMs.label")}
                description={t("settingsPage.transcription.vad.fields.minSpeechDurationMs.info")}
              />
              <Input
                type="number"
                step="10"
                min="50"
                max="2000"
                value={whisperVadMinSpeechDurationMs}
                onChange={(e) => setWhisperVadMinSpeechDurationMs(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <VADLabelWithInfo
                label={t("settingsPage.transcription.vad.fields.minSilenceDurationMs.label")}
                description={t("settingsPage.transcription.vad.fields.minSilenceDurationMs.info")}
              />
              <Input
                type="number"
                step="10"
                min="50"
                max="2000"
                value={whisperVadMinSilenceDurationMs}
                onChange={(e) => setWhisperVadMinSilenceDurationMs(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <VADLabelWithInfo
                label={t("settingsPage.transcription.vad.fields.maxSpeechDurationS.label")}
                description={t("settingsPage.transcription.vad.fields.maxSpeechDurationS.info")}
              />
              <Input
                type="number"
                step="1"
                min="5"
                max="120"
                value={whisperVadMaxSpeechDurationS}
                onChange={(e) => setWhisperVadMaxSpeechDurationS(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <VADLabelWithInfo
                label={t("settingsPage.transcription.vad.fields.speechPadMs.label")}
                description={t("settingsPage.transcription.vad.fields.speechPadMs.info")}
              />
              <Input
                type="number"
                step="10"
                min="0"
                max="1000"
                value={whisperVadSpeechPadMs}
                onChange={(e) => setWhisperVadSpeechPadMs(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <VADLabelWithInfo
                label={t("settingsPage.transcription.vad.fields.samplesOverlap.label")}
                description={t("settingsPage.transcription.vad.fields.samplesOverlap.info")}
              />
              <Input
                type="number"
                step="0.01"
                min="0"
                max="0.95"
                value={whisperVadSamplesOverlap}
                onChange={(e) => setWhisperVadSamplesOverlap(Number(e.target.value))}
              />
            </div>
          </div>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );

  const renderSectionContent = () => {
    switch (activeSection) {
      case "account":
      case "plansBilling":
        return (
          <div className="space-y-5">
            <SectionHeader
              title={t("desktop.settings.account", { defaultValue: "Account & Credits" })}
              description={t("desktop.settings.accountDescription", {
                defaultValue: "Your VoiceLab profile, secure desktop session and billing.",
              })}
            />

            {!isLoaded ? (
              <SettingsPanel>
                <SettingsPanelRow>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-11 w-11 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-36" />
                      <Skeleton className="h-3 w-52" />
                    </div>
                  </div>
                </SettingsPanelRow>
              </SettingsPanel>
            ) : isSignedIn ? (
              <>
                <SettingsPanel>
                  <SettingsPanelRow>
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e55347]/10">
                        {user?.image ? (
                          <img
                            src={user.image}
                            alt=""
                            className="h-11 w-11 rounded-full object-cover"
                          />
                        ) : (
                          <UserCircle className="h-6 w-6 text-[#e55347]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {user?.name ||
                            t("settingsPage.account.user", { defaultValue: "VoiceLab user" })}
                        </p>
                        {user?.email && (
                          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                        )}
                      </div>
                      <Badge variant="success">
                        {t("desktop.session.active", { defaultValue: "Signed in" })}
                      </Badge>
                    </div>
                  </SettingsPanelRow>
                  <SettingsPanelRow>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg bg-muted/45 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t("desktop.session.device", { defaultValue: "Device" })}
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {t("desktop.session.thisDevice", {
                            defaultValue: "This VoiceLab Dictate desktop",
                          })}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/45 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t("desktop.session.status", { defaultValue: "Session" })}
                        </p>
                        <p className="mt-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                          {t("desktop.session.protected", { defaultValue: "Active and protected" })}
                        </p>
                      </div>
                    </div>
                  </SettingsPanelRow>
                </SettingsPanel>

                <UsageDisplay />

                <Button
                  onClick={handleSignOut}
                  variant="outline"
                  disabled={isSigningOut}
                  className="w-full"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {isSigningOut
                    ? t("settingsPage.account.signOut.signingOut", { defaultValue: "Signing out…" })
                    : t("settingsPage.account.signOut.signOut", { defaultValue: "Sign out" })}
                </Button>
              </>
            ) : (
              <SettingsPanel>
                <SettingsPanelRow>
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {t("desktop.session.signedOut", { defaultValue: "Not signed in" })}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("desktop.session.signedOutDescription", {
                          defaultValue: "Sign in to use VoiceLab Cloud.",
                        })}
                      </p>
                    </div>
                    <Button onClick={startOnboarding} className="w-full">
                      <UserCircle className="mr-2 h-4 w-4" />
                      {t("auth.desktopOpenBrowser")}
                    </Button>
                  </div>
                </SettingsPanelRow>
              </SettingsPanel>
            )}
          </div>
        );

      case "workspace":
        return WORKSPACES_ENABLED ? <WorkspaceSection initialSubTab={initialSubTab} /> : null;

      case "general":
        return (
          <div className="space-y-6">
            {/* Appearance */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.appearance.title")}
                description={t("settingsPage.general.appearance.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.appearance.theme")}
                    description={t("settingsPage.general.appearance.themeDescription")}
                  >
                    <div className="inline-flex items-center gap-px p-0.5 bg-muted/60 dark:bg-surface-2 rounded-md">
                      {(
                        [
                          {
                            value: "light",
                            icon: Sun,
                            label: t("settingsPage.general.appearance.light"),
                          },
                          {
                            value: "dark",
                            icon: Moon,
                            label: t("settingsPage.general.appearance.dark"),
                          },
                          {
                            value: "auto",
                            icon: Monitor,
                            label: t("settingsPage.general.appearance.auto"),
                          },
                        ] as const
                      ).map((option) => {
                        const Icon = option.icon;
                        const isSelected = theme === option.value;
                        return (
                          <button
                            key={option.value}
                            onClick={() => setTheme(option.value)}
                            className={`
                              flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-xs font-medium
                              transition-colors duration-100
                              ${
                                isSelected
                                  ? "bg-background dark:bg-surface-raised text-foreground shadow-sm"
                                  : "text-muted-foreground hover:text-foreground"
                              }
                            `}
                          >
                            <Icon className={`w-3 h-3 ${isSelected ? "text-primary" : ""}`} />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Sound Effects */}
            <div>
              <SectionHeader title={t("settingsPage.general.soundEffects.title")} />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.soundEffects.dictationSounds")}
                    description={t("settingsPage.general.soundEffects.dictationSoundsDescription")}
                  >
                    <Toggle checked={audioCuesEnabled} onChange={setAudioCuesEnabled} />
                  </SettingsRow>
                </SettingsPanelRow>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.soundEffects.pauseMedia")}
                    description={t("settingsPage.general.soundEffects.pauseMediaDescription")}
                  >
                    <Toggle checked={pauseMediaOnDictation} onChange={setPauseMediaOnDictation} />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Notifications */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.notifications.title")}
                description={t("settingsPage.general.notifications.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.notifications.disableAll")}
                    description={t("settingsPage.general.notifications.disableAllDescription")}
                  >
                    <Toggle
                      checked={!notificationsEnabled}
                      onChange={(v) => setNotificationsEnabled(!v)}
                    />
                  </SettingsRow>
                </SettingsPanelRow>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.notifications.meetingDetection")}
                    description={t(
                      "settingsPage.general.notifications.meetingDetectionDescription"
                    )}
                  >
                    <Toggle
                      checked={notifyMeetingDetection}
                      onChange={setNotifyMeetingDetection}
                      disabled={!notificationsEnabled}
                    />
                  </SettingsRow>
                </SettingsPanelRow>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.notifications.calendarReminders")}
                    description={t(
                      "settingsPage.general.notifications.calendarRemindersDescription"
                    )}
                  >
                    <Toggle
                      checked={notifyCalendarReminders}
                      onChange={setNotifyCalendarReminders}
                      disabled={!notificationsEnabled}
                    />
                  </SettingsRow>
                </SettingsPanelRow>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.notifications.updates")}
                    description={t("settingsPage.general.notifications.updatesDescription")}
                  >
                    <Toggle
                      checked={notifyUpdates}
                      onChange={setNotifyUpdates}
                      disabled={!notificationsEnabled}
                    />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Clipboard */}
            <div>
              <SectionHeader title={t("settingsPage.general.clipboard.title")} />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.clipboard.autoPaste")}
                    description={t("settingsPage.general.clipboard.autoPasteDescription")}
                  >
                    <Toggle checked={autoPasteEnabled} onChange={setAutoPasteEnabled} />
                  </SettingsRow>
                </SettingsPanelRow>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.clipboard.keepInClipboard")}
                    description={t("settingsPage.general.clipboard.keepInClipboardDescription")}
                  >
                    <Toggle
                      checked={keepTranscriptionInClipboard}
                      onChange={setKeepTranscriptionInClipboard}
                    />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Save Notes as Files */}
            <div>
              <SectionHeader title={t("settings.noteFiles.title")} />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settings.noteFiles.title")}
                    description={t("settings.noteFiles.description")}
                  >
                    <Toggle checked={noteFilesEnabled} onChange={handleNoteFilesToggle} />
                  </SettingsRow>
                </SettingsPanelRow>
                {noteFilesEnabled && (
                  <>
                    <SettingsPanelRow>
                      <SettingsRow
                        label={t("settings.noteFiles.path")}
                        description={noteFilesPath || noteFilesDefaultPath || "..."}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={handleNoteFilesChangePath}
                        >
                          {t("settings.noteFiles.changePath")}
                        </Button>
                      </SettingsRow>
                    </SettingsPanelRow>
                    <SettingsPanelRow>
                      <SettingsRow
                        label={t("settings.noteFiles.rebuild")}
                        description={t("settings.noteFiles.rebuildDescription")}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={noteFilesRebuilding}
                          onClick={handleNoteFilesRebuild}
                        >
                          {noteFilesRebuilding ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            t("settings.noteFiles.rebuild")
                          )}
                        </Button>
                      </SettingsRow>
                    </SettingsPanelRow>
                  </>
                )}
              </SettingsPanel>
            </div>

            {/* Floating Icon */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.floatingIcon.title")}
                description={t("settingsPage.general.floatingIcon.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.floatingIcon.autoHide")}
                    description={t("settingsPage.general.floatingIcon.autoHideDescription")}
                  >
                    <Toggle checked={floatingIconAutoHide} onChange={setFloatingIconAutoHide} />
                  </SettingsRow>
                </SettingsPanelRow>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.floatingIcon.startPosition")}
                    description={t("settingsPage.general.floatingIcon.startPositionDescription")}
                  >
                    <select
                      value={panelStartPosition}
                      onChange={(e) =>
                        setPanelStartPosition(
                          e.target.value as "bottom-right" | "center" | "bottom-left"
                        )
                      }
                      className="h-7 rounded border border-border/70 bg-surface-1/80 px-2.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm hover:border-border-hover hover:bg-surface-2/70 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:ring-offset-1 transition-colors duration-200"
                    >
                      <option value="bottom-right">
                        {t("settingsPage.general.floatingIcon.bottomRight")}
                      </option>
                      <option value="center">
                        {t("settingsPage.general.floatingIcon.center")}
                      </option>
                      <option value="bottom-left">
                        {t("settingsPage.general.floatingIcon.bottomLeft")}
                      </option>
                    </select>
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Language */}
            <div>
              <SectionHeader
                title={t("settings.language.sectionTitle")}
                description={t("settings.language.sectionDescription")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settings.language.uiLabel")}
                    description={t("settings.language.uiDescription")}
                  >
                    <LanguageSelector
                      value={uiLanguage}
                      onChange={setUiLanguage}
                      options={UI_LANGUAGE_OPTIONS}
                      className="min-w-32"
                    />
                  </SettingsRow>
                </SettingsPanelRow>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settings.language.transcriptionLabel")}
                    description={t("settings.language.transcriptionDescription")}
                  >
                    <LanguageSelector
                      value={preferredLanguage}
                      onChange={(value) =>
                        updateTranscriptionSettings({ preferredLanguage: value })
                      }
                    />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Startup */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.startup.title")}
                description={t("settingsPage.general.startup.description")}
              />
              <SettingsPanel>
                {platform !== "linux" && (
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.general.startup.launchAtLogin")}
                      description={t("settingsPage.general.startup.launchAtLoginDescription")}
                    >
                      <Toggle
                        checked={autoStartEnabled}
                        onChange={(checked: boolean) => handleAutoStartChange(checked)}
                        disabled={autoStartLoading}
                      />
                    </SettingsRow>
                  </SettingsPanelRow>
                )}
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.startup.startMinimized")}
                    description={t("settingsPage.general.startup.startMinimizedDescription")}
                  >
                    <Toggle checked={startMinimized} onChange={setStartMinimized} />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Microphone */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.microphone.title")}
                description={t("settingsPage.general.microphone.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <MicrophoneSettings
                    preferBuiltInMic={preferBuiltInMic}
                    selectedMicDeviceId={selectedMicDeviceId}
                    selectedMicDeviceLabel={selectedMicDeviceLabel}
                    onPreferBuiltInChange={setPreferBuiltInMic}
                    onDeviceSelect={setSelectedMicDevice}
                  />
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Dictionary */}
            <div>
              <SectionHeader
                title={t("settingsPage.dictionary.autoLearnTitle", {
                  defaultValue: "Auto-learn from corrections",
                })}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.dictionary.autoLearnTitle", {
                      defaultValue: "Auto-learn from corrections",
                    })}
                    description={t("settingsPage.dictionary.autoLearnDescription", {
                      defaultValue:
                        "When you correct a transcription in the target app, the corrected word is automatically added to your dictionary.",
                    })}
                  >
                    <Toggle checked={autoLearnCorrections} onChange={setAutoLearnCorrections} />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Wayland Paste Diagnostics — only on Linux + Wayland */}
            {ydotoolStatus?.isLinux && ydotoolStatus?.isWayland && (
              <div>
                <SectionHeader
                  title={t("settingsPage.general.waylandPaste.title", {
                    defaultValue: "Wayland Paste Setup",
                  })}
                  description={t("settingsPage.general.waylandPaste.description", {
                    defaultValue:
                      "Auto-paste on Wayland requires ydotool. Check the status of each component below.",
                  })}
                />
                {(() => {
                  if (ydotoolStatus.isNixOS) {
                    return (
                      <NixOsPasteInfo status={ydotoolStatus} onRecheck={refreshYdotoolStatus} />
                    );
                  }
                  const checks = [
                    {
                      key: "hasYdotool",
                      label: "ydotool",
                      ok: ydotoolStatus.hasYdotool,
                      desc: t("settingsPage.general.waylandPaste.ydotoolDesc", {
                        defaultValue: "Input automation tool for Wayland",
                      }),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.ydotool.step1Title", {
                            defaultValue: "Install ydotool",
                          }),
                          desc: t("settingsPage.general.waylandPaste.guide.ydotool.step1Desc", {
                            defaultValue:
                              "Use your distribution's package manager to install ydotool.",
                          }),
                          cmds: [
                            { label: "Ubuntu / Pop!_OS / Debian", cmd: "sudo apt install ydotool" },
                            { label: "Fedora", cmd: "sudo dnf install ydotool" },
                            { label: "Arch Linux", cmd: "sudo pacman -S ydotool" },
                            { label: "openSUSE", cmd: "sudo zypper install ydotool" },
                          ],
                        },
                        {
                          title: t("settingsPage.general.waylandPaste.guide.ydotool.step2Title", {
                            defaultValue: "Verify installation",
                          }),
                          desc: t("settingsPage.general.waylandPaste.guide.ydotool.step2Desc", {
                            defaultValue: "Check that ydotool is available in your PATH.",
                          }),
                          cmds: [{ cmd: "which ydotool" }],
                        },
                      ],
                    },
                    {
                      key: "hasYdotoold",
                      label: "ydotoold",
                      ok: ydotoolStatus.hasYdotoold,
                      desc: t("settingsPage.general.waylandPaste.ydotooldDesc", {
                        defaultValue: "Daemon for ydotool (separate package on Ubuntu/Pop!_OS)",
                      }),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.ydotoold.step1Title", {
                            defaultValue: "Install ydotoold",
                          }),
                          desc: t("settingsPage.general.waylandPaste.guide.ydotoold.step1Desc", {
                            defaultValue:
                              "On Ubuntu and Pop!_OS, ydotoold is a separate package. On Fedora, it's included with ydotool.",
                          }),
                          cmds: [
                            {
                              label: "Ubuntu / Pop!_OS / Debian",
                              cmd: "sudo apt install ydotoold",
                            },
                            { label: "Fedora", cmd: "# Already included in the ydotool package" },
                            { label: "Arch Linux", cmd: "# Included in the ydotool package" },
                          ],
                        },
                      ],
                    },
                    {
                      key: "hasUinput",
                      label: "/dev/uinput",
                      ok: ydotoolStatus.hasUinput,
                      desc: t("settingsPage.general.waylandPaste.uinputDesc", {
                        defaultValue: "Kernel input device access",
                      }),
                      note: !ydotoolStatus.hasUinput
                        ? ydotoolStatus.hasUdevRule
                          ? t("settingsPage.general.waylandPaste.uinputRuleFound", {
                              defaultValue: "Rule present but not active. A reboot should fix it.",
                            })
                          : t("settingsPage.general.waylandPaste.uinputRuleMissing", {
                              defaultValue: "no udev rule found",
                            })
                        : undefined,
                      steps:
                        ydotoolStatus.hasUdevRule && !ydotoolStatus.hasUinput
                          ? [
                              {
                                title: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.ruleFoundTitle",
                                  {
                                    defaultValue: "udev rule already configured",
                                  }
                                ),
                                desc: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.ruleFoundDesc",
                                  {
                                    defaultValue:
                                      "The udev rule for /dev/uinput is already on your system but hasn't taken effect. Try reloading:",
                                  }
                                ),
                                cmds: [
                                  {
                                    cmd: "sudo udevadm control --reload-rules && sudo udevadm trigger /dev/uinput",
                                  },
                                ],
                              },
                              {
                                title: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.rebootTitle",
                                  {
                                    defaultValue: "If reloading didn't help, reboot",
                                  }
                                ),
                                desc: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.rebootDesc",
                                  {
                                    defaultValue:
                                      "On some distros, udev changes only apply after a full reboot. Restart your computer and come back to re-check.",
                                  }
                                ),
                              },
                            ]
                          : [
                              {
                                title: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.step1Title",
                                  {
                                    defaultValue: "Create a udev rule",
                                  }
                                ),
                                desc: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.step1Desc",
                                  {
                                    defaultValue:
                                      "This rule grants access to /dev/uinput for users in the input group.",
                                  }
                                ),
                                cmds: [
                                  {
                                    cmd: 'echo \'KERNEL=="uinput", GROUP="input", MODE="0660", TAG+="uaccess"\' | sudo tee /etc/udev/rules.d/70-uinput.rules',
                                  },
                                ],
                              },
                              {
                                title: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.step2Title",
                                  {
                                    defaultValue: "Reload udev rules",
                                  }
                                ),
                                desc: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.step2Desc",
                                  {
                                    defaultValue: "Apply the new rule without rebooting.",
                                  }
                                ),
                                cmds: [
                                  {
                                    cmd: "sudo udevadm control --reload-rules && sudo udevadm trigger /dev/uinput",
                                  },
                                ],
                              },
                            ],
                    },
                    {
                      key: "hasGroup",
                      label: t("settingsPage.general.waylandPaste.inputGroup", {
                        defaultValue: "input group",
                      }),
                      ok: ydotoolStatus.hasGroup,
                      desc: t("settingsPage.general.waylandPaste.inputGroupDesc", {
                        defaultValue: "User must be in the input group (requires re-login)",
                      }),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.group.step1Title", {
                            defaultValue: "Add your user to the input group",
                          }),
                          cmds: [{ cmd: "sudo usermod -aG input $USER" }],
                        },
                        {
                          title: t("settingsPage.general.waylandPaste.guide.group.step2Title", {
                            defaultValue: "Log out and back in",
                          }),
                          desc: t("settingsPage.general.waylandPaste.guide.group.step2Desc", {
                            defaultValue:
                              "Group changes only take effect after a new login session. Log out of your desktop and log back in, then reopen VoiceLab.",
                          }),
                        },
                      ],
                    },
                    {
                      key: "hasService",
                      label: t("settingsPage.general.waylandPaste.service", {
                        defaultValue: "systemd service",
                      }),
                      ok: ydotoolStatus.hasService,
                      desc: t("settingsPage.general.waylandPaste.serviceDesc", {
                        defaultValue: "User service file for auto-starting ydotoold",
                      }),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.service.step1Title", {
                            defaultValue: "Create the service directory",
                          }),
                          cmds: [{ cmd: "mkdir -p ~/.config/systemd/user" }],
                        },
                        {
                          title: t("settingsPage.general.waylandPaste.guide.service.step2Title", {
                            defaultValue: "Create the service file",
                          }),
                          desc: t("settingsPage.general.waylandPaste.guide.service.step2Desc", {
                            defaultValue:
                              "This creates a user-level systemd service that starts ydotoold automatically when you log in.",
                          }),
                          cmds: [
                            {
                              cmd: `cat > ~/.config/systemd/user/ydotoold.service << 'EOF'
[Unit]
Description=ydotoold - ydotool daemon
After=graphical-session.target
PartOf=graphical-session.target

[Service]
ExecStart=/usr/bin/ydotoold
Restart=on-failure
RestartSec=1s

[Install]
WantedBy=graphical-session.target
EOF`,
                            },
                          ],
                        },
                        {
                          title: t("settingsPage.general.waylandPaste.guide.service.step3Title", {
                            defaultValue: "Reload and enable",
                          }),
                          cmds: [
                            {
                              cmd: "systemctl --user daemon-reload && systemctl --user enable ydotoold",
                            },
                          ],
                        },
                      ],
                    },
                    {
                      key: "daemonRunning",
                      label: t("settingsPage.general.waylandPaste.daemon", {
                        defaultValue: "ydotoold daemon",
                      }),
                      ok: ydotoolStatus.daemonRunning,
                      desc: t("settingsPage.general.waylandPaste.daemonDesc", {
                        defaultValue: "Background service must be running",
                      }),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.daemon.step1Title", {
                            defaultValue: "Start the daemon",
                          }),
                          desc: t("settingsPage.general.waylandPaste.guide.daemon.step1Desc", {
                            defaultValue: "Start ydotoold and enable it so it runs on every login.",
                          }),
                          cmds: [
                            {
                              cmd: "systemctl --user enable ydotoold && systemctl --user start ydotoold",
                            },
                            {
                              label: "Arch Linux (service is named ydotool.service)",
                              cmd: "systemctl --user enable --now ydotool.service",
                            },
                          ],
                        },
                        {
                          title: t("settingsPage.general.waylandPaste.guide.daemon.step2Title", {
                            defaultValue: "Verify it's running",
                          }),
                          cmds: [
                            { cmd: "systemctl --user status ydotoold" },
                            {
                              label: "Arch Linux",
                              cmd: "systemctl --user status ydotool.service",
                            },
                          ],
                        },
                      ],
                    },
                  ];

                  if (ydotoolStatus.isKde) {
                    checks.push({
                      key: "hasXclip",
                      label: "xclip",
                      ok: ydotoolStatus.hasXclip || ydotoolStatus.hasXsel || false,
                      desc: t("settingsPage.general.waylandPaste.xclipDesc", {
                        defaultValue: "Clipboard tool for KDE Wayland paste (xclip or xsel)",
                      }),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.xclip.step1Title", {
                            defaultValue: "Install xclip",
                          }),
                          cmds: [
                            { cmd: "sudo dnf install xclip  # Fedora" },
                            { cmd: "sudo apt install xclip  # Debian/Ubuntu" },
                          ],
                        },
                      ],
                    });
                  }

                  const allOk = checks.every((c) => c.ok);
                  const activeGuide = checks.find((c) => c.key === ydotoolGuideKey);

                  return (
                    <>
                      {allOk ? (
                        <SettingsPanel>
                          <SettingsPanelRow>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <CircleCheck className="h-4 w-4 text-emerald-500" />
                                <span className="text-sm">
                                  {t("settingsPage.general.waylandPaste.allGoodDesc", {
                                    defaultValue: "Auto-paste is ready to go.",
                                  })}
                                </span>
                              </div>
                              <button
                                onClick={refreshYdotoolStatus}
                                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <RotateCw className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </SettingsPanelRow>
                        </SettingsPanel>
                      ) : (
                        <>
                          <div className="rounded-xl border border-border overflow-hidden">
                            <div className="divide-y divide-border">
                              {checks.map((item) => (
                                <div key={item.key} className="px-4 py-3">
                                  <div className="flex items-center gap-2.5">
                                    {item.ok ? (
                                      <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                                    ) : (
                                      <CircleX className="h-4 w-4 shrink-0 text-red-500" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <span className="text-sm font-medium">{item.label}</span>
                                      <span className="text-xs text-muted-foreground ml-2">
                                        {item.desc}
                                      </span>
                                      {item.note && (
                                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                                          {item.note}
                                        </p>
                                      )}
                                    </div>
                                    {!item.ok && (
                                      <button
                                        onClick={() => setYdotoolGuideKey(item.key)}
                                        className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted transition-colors text-foreground"
                                      >
                                        <BookOpen className="w-3 h-3" />
                                        {t("settingsPage.general.waylandPaste.guide.open", {
                                          defaultValue: "Guide",
                                        })}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={refreshYdotoolStatus}
                            className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <RotateCw className="w-3 h-3" />
                            {t("settingsPage.general.waylandPaste.recheck", {
                              defaultValue: "Re-check",
                            })}
                          </button>
                        </>
                      )}

                      {/* Step-by-step guide dialog */}
                      <Dialog
                        open={!!activeGuide}
                        onOpenChange={(open) => !open && setYdotoolGuideKey(null)}
                      >
                        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
                          {activeGuide && (
                            <>
                              <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                  <BookOpen className="w-4 h-4" />
                                  {activeGuide.label}
                                </DialogTitle>
                                <DialogDescription>{activeGuide.desc}</DialogDescription>
                              </DialogHeader>
                              <div className="space-y-5 mt-2">
                                {activeGuide.steps.map((step, i) => (
                                  <div key={i}>
                                    <div className="flex items-start gap-3">
                                      <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                                        {i + 1}
                                      </span>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium">{step.title}</p>
                                        {step.desc && (
                                          <p className="text-xs text-muted-foreground mt-0.5">
                                            {step.desc}
                                          </p>
                                        )}
                                        {step.cmds && step.cmds.length > 0 && (
                                          <div className="mt-2 space-y-2">
                                            {step.cmds.map((c, j) => (
                                              <div key={j}>
                                                {c.label && (
                                                  <p className="text-[11px] text-muted-foreground mb-1">
                                                    {c.label}
                                                  </p>
                                                )}
                                                <div className="flex items-start gap-1.5">
                                                  <pre className="flex-1 text-[11px] bg-muted/60 rounded-md px-3 py-2 font-mono whitespace-pre-wrap break-all select-all overflow-x-auto">
                                                    {c.cmd}
                                                  </pre>
                                                  <button
                                                    onClick={() =>
                                                      navigator.clipboard.writeText(c.cmd)
                                                    }
                                                    className="shrink-0 p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                                    title={t(
                                                      "settingsPage.general.waylandPaste.copy",
                                                      { defaultValue: "Copy" }
                                                    )}
                                                  >
                                                    <Copy className="w-3.5 h-3.5" />
                                                  </button>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </DialogContent>
                      </Dialog>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        );

      case "hotkeys":
        return (
          <div className="space-y-6">
            {isUsingHyprland && hyprlandConfigStatus && !hyprlandConfigStatus.canWrite && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>
                  {t("settingsPage.general.hotkey.hyprlandConfigWriteWarningTitle")}
                </AlertTitle>
                <AlertDescription>
                  {t("settingsPage.general.hotkey.hyprlandConfigWriteWarningDescription", {
                    path: hyprlandConfigStatus.path,
                  })}
                </AlertDescription>
              </Alert>
            )}
            {/* Dictation Hotkey */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.hotkey.title")}
                description={t("settingsPage.general.hotkey.description")}
                note={isUsingHyprland && t("settingsPage.general.hotkey.hyprlandUnbindDescription")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <HotkeyListInput
                    value={dictationKey}
                    onChange={(list) => registerHotkey(list)}
                    validate={validateDictationHotkey}
                    disabled={isHotkeyRegistering}
                    maxHotkeys={isUsingNativeShortcut ? 1 : undefined}
                    required
                    footerEnd={
                      effectiveDefaultHotkey &&
                      dictationKey &&
                      dictationKey !== effectiveDefaultHotkey ? (
                        <button
                          onClick={() => registerHotkey(effectiveDefaultHotkey)}
                          disabled={isHotkeyRegistering}
                          className="text-xs text-muted-foreground/70 hover:text-foreground transition-colors disabled:opacity-50"
                        >
                          {t("settingsPage.general.hotkey.resetToDefault", {
                            hotkey: formatHotkeyLabel(effectiveDefaultHotkey),
                          })}
                        </button>
                      ) : null
                    }
                  />
                </SettingsPanelRow>

                {(!isUsingNativeShortcut || getCachedPlatform() === "linux") && (
                  <SettingsPanelRow>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground/80">
                        {t("settingsPage.general.hotkey.activationMode")}
                      </span>
                      <ActivationModeSelector value={activationMode} onChange={setActivationMode} />
                    </div>
                    {getCachedPlatform() === "linux" && activationMode === "push" && (
                      <LinuxPttSetupInfo isAvailable={linuxPttAvailable} />
                    )}
                  </SettingsPanelRow>
                )}
              </SettingsPanel>
            </div>

            {/* Voice Agent Hotkey */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.voiceAgentHotkey.title")}
                description={t("settingsPage.general.voiceAgentHotkey.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <HotkeyListInput
                    value={voiceAgentKey}
                    onChange={(list) => commitAgentHotkey(setVoiceAgentKey, list)}
                    onClear={() => commitAgentHotkey(setVoiceAgentKey, "")}
                    validate={validateVoiceAgentHotkey}
                    disabled={isAgentHotkeyCommitting}
                    maxHotkeys={isUsingNativeShortcut ? 1 : undefined}
                  />
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Translation Hotkey */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.translationHotkey.title")}
                description={t("settingsPage.general.translationHotkey.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <HotkeyListInput
                    value={translationKey}
                    onChange={(list) => commitAgentHotkey(setTranslationKey, list)}
                    onClear={() => commitAgentHotkey(setTranslationKey, "")}
                    validate={validateTranslationHotkey}
                    disabled={isAgentHotkeyCommitting}
                    maxHotkeys={isUsingNativeShortcut ? 1 : undefined}
                  />
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Meeting Mode Hotkey */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.meetingHotkey.title")}
                description={t("settingsPage.general.meetingHotkey.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <HotkeyListInput
                    value={meetingKey}
                    onChange={(list) => registerMeetingHotkey(list)}
                    onClear={async () => {
                      await window.electronAPI?.registerMeetingHotkey?.("");
                      setMeetingKey("");
                    }}
                    validate={validateMeetingHotkey}
                    disabled={isMeetingHotkeyRegistering}
                    maxHotkeys={isUsingNativeShortcut ? 1 : undefined}
                  />
                </SettingsPanelRow>
                <SettingsPanelRow className="flex items-center justify-between gap-3 border-t border-border/40 dark:border-white/5">
                  <span className="text-xs text-muted-foreground/80">
                    {t("settingsPage.general.meetingHotkey.layoutLabel")}
                  </span>
                  <Select
                    value={meetingHotkeyLayoutMode}
                    onValueChange={(value) =>
                      setMeetingHotkeyLayoutMode(value as "side-panel" | "full-width")
                    }
                  >
                    <SelectTrigger className="h-7 w-36 text-xs rounded-lg px-2.5 [&>svg]:h-3 [&>svg]:w-3">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value="full-width"
                        className="text-xs py-1.5 pl-2.5 pr-7 rounded-md"
                      >
                        {t("settingsPage.general.meetingHotkey.layoutFullWidth")}
                      </SelectItem>
                      <SelectItem
                        value="side-panel"
                        className="text-xs py-1.5 pl-2.5 pr-7 rounded-md"
                      >
                        {t("settingsPage.general.meetingHotkey.layoutSidePanel")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Chat Agent Hotkey */}
            <div>
              <SectionHeader
                title={t("agentMode.settings.hotkey")}
                description={t("agentMode.settings.hotkeyDescription")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <HotkeyListInput
                    value={chatAgentKey}
                    onChange={(list) => commitAgentHotkey(setChatAgentKey, list)}
                    onClear={() => commitAgentHotkey(setChatAgentKey, "")}
                    validate={validateChatAgentHotkey}
                    disabled={isAgentHotkeyCommitting}
                    maxHotkeys={isUsingNativeShortcut ? 1 : undefined}
                  />
                </SettingsPanelRow>
              </SettingsPanel>
            </div>
          </div>
        );

      case "speechToText":
      case "llms":
        return null;

      case "privacyData":
        return (
          <div className="space-y-6">
            {/* Privacy */}
            <div>
              <SectionHeader
                title={t("settingsPage.privacy.title")}
                description={t("settingsPage.privacy.description")}
              />

              {isSignedIn && (
                <SettingsPanel className="mb-4">
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("desktop.privacy.transcriptBackup")}
                      description={t("desktop.privacy.transcriptBackupDescription")}
                    >
                      <Badge variant="outline">{t("desktop.privacy.notEnabled")}</Badge>
                    </SettingsRow>
                  </SettingsPanelRow>
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("desktop.privacy.audioBackup")}
                      description={t("desktop.privacy.audioBackupDescription")}
                    >
                      <Badge variant="outline">{t("desktop.privacy.notAvailable")}</Badge>
                    </SettingsRow>
                  </SettingsPanelRow>
                </SettingsPanel>
              )}

              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.privacy.usageAnalytics")}
                    description={t("settingsPage.privacy.usageAnalyticsDescription")}
                  >
                    <Toggle checked={telemetryEnabled} onChange={setTelemetryEnabled} />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Audio Retention */}
            <div className="border-t border-border/40 pt-6">
              <SectionHeader
                title={t("desktop.privacy.localAudio")}
                description={t("desktop.privacy.localAudioDescription")}
              />

              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.privacy.audioRetention")}
                    description={t("settingsPage.privacy.audioRetentionDescription")}
                  >
                    <select
                      value={audioRetentionDays}
                      onChange={(e) => setAudioRetentionDays(parseInt(e.target.value, 10))}
                      className="h-7 rounded border border-border/70 bg-surface-1/80 px-2.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm hover:border-border-hover hover:bg-surface-2/70 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:ring-offset-1 transition-colors duration-200"
                    >
                      <option value={0}>{t("settingsPage.privacy.audioRetentionDisabled")}</option>
                      <option value={7}>
                        {t("settingsPage.privacy.audioRetentionDays", { count: 7 })}
                      </option>
                      <option value={14}>
                        {t("settingsPage.privacy.audioRetentionDays", { count: 14 })}
                      </option>
                      <option value={30}>
                        {t("settingsPage.privacy.audioRetentionDays", { count: 30 })}
                      </option>
                      <option value={60}>
                        {t("settingsPage.privacy.audioRetentionDays", { count: 60 })}
                      </option>
                      <option value={90}>
                        {t("settingsPage.privacy.audioRetentionDays", { count: 90 })}
                      </option>
                    </select>
                  </SettingsRow>
                </SettingsPanelRow>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.privacy.audioStorageUsage")}
                    description={
                      audioStorageUsage.fileCount > 0
                        ? t("settingsPage.privacy.audioStorageFiles", {
                            count: audioStorageUsage.fileCount,
                            size: formatBytes(audioStorageUsage.totalBytes),
                          })
                        : t("settingsPage.privacy.audioStorageEmpty")
                    }
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={audioStorageUsage.fileCount === 0}
                      onClick={handleClearAllAudio}
                    >
                      {t("settingsPage.privacy.clearAllAudio")}
                    </Button>
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Data Retention */}
            <div className="border-t border-border/40 pt-6">
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.privacy.dataRetention")}
                    description={t("settingsPage.privacy.dataRetentionDescription")}
                  >
                    <Toggle checked={dataRetentionEnabled} onChange={setDataRetentionEnabled} />
                  </SettingsRow>
                </SettingsPanelRow>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.privacy.saveDiscarded")}
                    description={t("settingsPage.privacy.saveDiscardedDescription")}
                  >
                    <Toggle
                      checked={saveDiscardedTranscriptions}
                      disabled={!dataRetentionEnabled || audioRetentionDays === 0}
                      onChange={setSaveDiscardedTranscriptions}
                    />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Permissions */}
            <div className="border-t border-border/40 pt-6">
              <SectionHeader
                title={t("settingsPage.permissions.title")}
                description={t("settingsPage.permissions.description")}
              />

              <div className="space-y-3">
                <PermissionCard
                  icon={Mic}
                  title={t("settingsPage.permissions.microphoneTitle")}
                  description={t("settingsPage.permissions.microphoneDescription")}
                  granted={permissionsHook.micPermissionGranted}
                  onRequest={permissionsHook.requestMicPermission}
                  buttonText={t("settingsPage.permissions.grantAccess")}
                />

                {(platform === "darwin" || canManageSystemAudioInApp(systemAudio)) && (
                  <>
                    {platform === "darwin" && (
                      <PermissionCard
                        icon={Shield}
                        title={t("settingsPage.permissions.accessibilityTitle")}
                        description={t("settingsPage.permissions.accessibilityDescription")}
                        granted={permissionsHook.accessibilityPermissionGranted}
                        onRequest={permissionsHook.requestAccessibilityPermission}
                        buttonText={t("settingsPage.permissions.grantAccess")}
                      />
                    )}
                    {canManageSystemAudioInApp(systemAudio) && (
                      <PermissionCard
                        icon={Monitor}
                        title={t("settingsPage.permissions.systemAudioTitle")}
                        description={t("settingsPage.permissions.systemAudioDescription")}
                        granted={systemAudio.granted}
                        onRequest={systemAudio.request}
                        buttonText={t("settingsPage.permissions.grantAccess")}
                        badge={t("settingsPage.permissions.optional")}
                      />
                    )}
                  </>
                )}
              </div>

              {!permissionsHook.micPermissionGranted && permissionsHook.micPermissionError && (
                <MicPermissionWarning
                  error={permissionsHook.micPermissionError}
                  onOpenSoundSettings={permissionsHook.openSoundInputSettings}
                  onOpenPrivacySettings={permissionsHook.openMicPrivacySettings}
                />
              )}

              {platform === "linux" &&
                permissionsHook.pasteToolsInfo &&
                !permissionsHook.pasteToolsInfo.available && (
                  <PasteToolsInfo
                    pasteToolsInfo={permissionsHook.pasteToolsInfo}
                    isChecking={permissionsHook.isCheckingPasteTools}
                    onCheck={permissionsHook.checkPasteToolsAvailability}
                  />
                )}

              {platform === "darwin" && (
                <div className="mt-5">
                  <p className="text-xs font-medium text-foreground mb-3">
                    {t("settingsPage.permissions.troubleshootingTitle")}
                  </p>
                  <SettingsPanel>
                    <SettingsPanelRow>
                      <SettingsRow
                        label={t("settingsPage.permissions.resetAccessibility.label")}
                        description={t(
                          "settingsPage.permissions.resetAccessibility.rowDescription"
                        )}
                      >
                        <Button
                          onClick={resetAccessibilityPermissions}
                          variant="ghost"
                          size="sm"
                          className="text-foreground/70 hover:text-foreground"
                        >
                          {t("settingsPage.permissions.troubleshoot")}
                        </Button>
                      </SettingsRow>
                    </SettingsPanelRow>
                  </SettingsPanel>
                </div>
              )}
            </div>
          </div>
        );

      case "system":
        return (
          <div className="space-y-6">
            <div>
              <SectionHeader
                title={t("desktop.settings.cloudTranscription", {
                  defaultValue: "Cloud transcription",
                })}
                description={t("desktop.settings.cloudTranscriptionDescription", {
                  defaultValue: "VoiceLab Dictate uses your signed-in account automatically.",
                })}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <div className="rounded-xl border border-[#e55347]/45 bg-[#e55347]/8 p-4">
                    <div className="flex items-start gap-3">
                      <Cloud className="mb-2 h-5 w-5 text-[#e55347]" />
                      <div>
                        <strong className="block text-sm">VoiceLab Cloud</strong>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          No API key is required. Dictation starts after sign-in and usage is
                          charged from your VoiceLab AI Credits balance.
                        </span>
                      </div>
                    </div>
                  </div>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>
            {/* Software Updates */}
            <div>
              <SectionHeader title={t("settingsPage.general.updates.title")} />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.updates.currentVersion")}
                    description={
                      updateStatus.isDevelopment
                        ? t("settingsPage.general.updates.devMode")
                        : isUpdateAvailable
                          ? t("settingsPage.general.updates.newVersionAvailable")
                          : t("settingsPage.general.updates.latestVersion")
                    }
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs tabular-nums text-muted-foreground font-mono">
                        {currentVersion || t("settingsPage.general.updates.versionPlaceholder")}
                      </span>
                      {updateStatus.isDevelopment ? (
                        <Badge variant="warning">
                          {t("settingsPage.general.updates.badges.dev")}
                        </Badge>
                      ) : isUpdateAvailable ? (
                        <Badge variant="success">
                          {t("settingsPage.general.updates.badges.update")}
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          {t("settingsPage.general.updates.badges.latest")}
                        </Badge>
                      )}
                    </div>
                  </SettingsRow>
                </SettingsPanelRow>

                <SettingsPanelRow>
                  <div className="space-y-2.5">
                    <Button
                      onClick={async () => {
                        try {
                          const result = await checkForUpdates();
                          if (result && !result.updateAvailable) {
                            toast({
                              title: t("settingsPage.general.updates.dialogs.noUpdates.title"),
                              description: t(
                                "settingsPage.general.updates.dialogs.noUpdates.description"
                              ),
                            });
                          }
                        } catch {}
                      }}
                      disabled={checkingForUpdates || updateStatus.isDevelopment}
                      variant="outline"
                      className="w-full"
                      size="sm"
                    >
                      <RefreshCw
                        size={13}
                        className={`mr-1.5 ${checkingForUpdates ? "animate-spin" : ""}`}
                      />
                      {checkingForUpdates
                        ? t("settingsPage.general.updates.checking")
                        : t("settingsPage.general.updates.checkForUpdates")}
                    </Button>

                    {isUpdateAvailable && !updateStatus.updateDownloaded && (
                      <div className="space-y-2">
                        <Button
                          onClick={async () => {
                            try {
                              await downloadUpdate();
                            } catch {
                              showAlertDialog({
                                title: t(
                                  "settingsPage.general.updates.dialogs.downloadFailed.title"
                                ),
                                description: t(
                                  "settingsPage.general.updates.dialogs.downloadFailed.description"
                                ),
                              });
                            }
                          }}
                          disabled={downloadingUpdate}
                          variant="success"
                          className="w-full"
                          size="sm"
                        >
                          <Download
                            size={13}
                            className={`mr-1.5 ${downloadingUpdate ? "animate-pulse" : ""}`}
                          />
                          {downloadingUpdate
                            ? t("settingsPage.general.updates.downloading", {
                                progress: Math.round(updateDownloadProgress),
                              })
                            : t("settingsPage.general.updates.downloadUpdate", {
                                version: updateInfo?.version || "",
                              })}
                        </Button>

                        {downloadingUpdate && (
                          <div className="h-1 w-full overflow-hidden rounded-full bg-muted/50">
                            <div
                              className="h-full bg-success transition-[width] duration-200 rounded-full"
                              style={{
                                width: `${Math.min(100, Math.max(0, updateDownloadProgress))}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {updateStatus.updateDownloaded && (
                      <Button
                        onClick={() => {
                          showConfirmDialog({
                            title: t("settingsPage.general.updates.dialogs.installUpdate.title"),
                            description: t(
                              "settingsPage.general.updates.dialogs.installUpdate.description",
                              { version: updateInfo?.version || "" }
                            ),
                            confirmText: t(
                              "settingsPage.general.updates.dialogs.installUpdate.confirmText"
                            ),
                            onConfirm: async () => {
                              try {
                                await installUpdateAction();
                              } catch {
                                showAlertDialog({
                                  title: t(
                                    "settingsPage.general.updates.dialogs.installFailed.title"
                                  ),
                                  description: t(
                                    "settingsPage.general.updates.dialogs.installFailed.description"
                                  ),
                                });
                              }
                            },
                          });
                        }}
                        disabled={installInitiated}
                        className="w-full"
                        size="sm"
                      >
                        <RefreshCw
                          size={14}
                          className={`mr-2 ${installInitiated ? "animate-spin" : ""}`}
                        />
                        {installInitiated
                          ? t("settingsPage.general.updates.restarting")
                          : t("settingsPage.general.updates.installAndRestart")}
                      </Button>
                    )}
                  </div>

                  {updateInfo?.releaseNotes && (
                    <div className="mt-4 pt-4 border-t border-border/30">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        {t("settingsPage.general.updates.whatsNew", {
                          version: updateInfo.version,
                        })}
                      </p>
                      <div className="text-xs text-muted-foreground [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:space-y-1 [&_li]:pl-1 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_a]:text-link [&_a]:underline">
                        <ReactMarkdown
                          skipHtml
                          components={{
                            a: ({ href, children }) => {
                              const safeHref =
                                typeof href === "string" &&
                                (href.startsWith("https://") || href.startsWith("mailto:"))
                                  ? href
                                  : undefined;
                              return safeHref ? (
                                <a href={safeHref} target="_blank" rel="noreferrer noopener">
                                  {children}
                                </a>
                              ) : (
                                <span>{children}</span>
                              );
                            },
                          }}
                        >
                          {updateInfo.releaseNotes}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Developer Tools */}
            <div className="border-t border-border/40 pt-6">
              <DeveloperSection />
            </div>

            {/* Data Management */}
            <div className="border-t border-border/40 pt-6">
              <SectionHeader
                title={t("settingsPage.developer.dataManagementTitle")}
                description={t("settingsPage.developer.dataManagementDescription")}
              />

              <div className="space-y-4">
                <SettingsPanel>
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.developer.modelCache")}
                      description={t("settingsPage.developer.dataManagementDescription")}
                    >
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.electronAPI?.openModelCacheFolder?.()}
                        >
                          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                          {t("settingsPage.developer.open")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={handleRemoveModels}
                          disabled={isRemovingModels}
                        >
                          {isRemovingModels
                            ? t("settingsPage.developer.removing")
                            : t("settingsPage.developer.clearCache")}
                        </Button>
                      </div>
                    </SettingsRow>
                  </SettingsPanelRow>
                </SettingsPanel>

                <SettingsPanel>
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.developer.resetAppData")}
                      description={t("settingsPage.developer.resetAppDataDescription")}
                    >
                      <Button
                        onClick={() => {
                          showConfirmDialog({
                            title: t("settingsPage.developer.resetAll.title"),
                            description: t("settingsPage.developer.resetAll.description"),
                            onConfirm: async () => {
                              try {
                                try {
                                  await signOut();
                                } catch {}
                                await window.electronAPI?.cleanupApp();
                                showAlertDialog({
                                  title: t("settingsPage.developer.resetAll.successTitle"),
                                  description: t(
                                    "settingsPage.developer.resetAll.successDescription"
                                  ),
                                });
                                setTimeout(() => {
                                  window.location.reload();
                                }, 1000);
                              } catch {
                                showAlertDialog({
                                  title: t("settingsPage.developer.resetAll.failedTitle"),
                                  description: t(
                                    "settingsPage.developer.resetAll.failedDescription"
                                  ),
                                });
                              }
                            },
                            variant: "destructive",
                            confirmText: t("settingsPage.developer.resetAll.confirmText"),
                          });
                        }}
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive"
                      >
                        {t("common.reset")}
                      </Button>
                    </SettingsRow>
                  </SettingsPanelRow>
                </SettingsPanel>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      <div className="mx-auto w-full max-w-3xl pb-6">
        {/* Mounted on first visit and kept alive so model-download progress and IPC listeners survive section switches. */}
        {hasMountedSpeechToText && (
          <TabPanel active={activeSection === "speechToText"}>
            <SpeechToTextTabs
              initialTab={
                activeSection === "speechToText"
                  ? (initialSubTab as SpeechTab | undefined)
                  : undefined
              }
              renderDictation={() => (
                <div className="space-y-6">
                  <TranscriptionSection
                    showTranscriptionPreview={showTranscriptionPreview}
                    setShowTranscriptionPreview={setShowTranscriptionPreview}
                  />
                </div>
              )}
              renderNoteRecording={() => (
                <div className="space-y-6">
                  <MeetingTranscriptionPanel />
                </div>
              )}
              renderUpload={() => (
                <div className="space-y-6">
                  <UploadTranscriptionPanel />
                </div>
              )}
            />
          </TabPanel>
        )}
        {hasMountedLlms && (
          <TabPanel active={activeSection === "llms"}>
            <div className="space-y-4">
              <SectionHeader
                title={t("settingsPage.llms.title")}
                description={t("settingsPage.llms.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t("settingsPage.llms.temporarilyDisabled", {
                      defaultValue:
                        "LLM provider settings are temporarily disabled. Speech uses VoiceLab Cloud only.",
                    })}
                  </p>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>
          </TabPanel>
        )}
        {renderSectionContent()}
      </div>
    </>
  );
}
