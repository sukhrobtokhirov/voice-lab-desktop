import React, { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import {
  AlertTriangle,
  Zap,
  ChevronLeft,
} from "lucide-react";
import PostMigrationOnboarding from "./PostMigrationOnboarding";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useDialogs } from "../hooks/useDialogs";
import { useHotkey } from "../hooks/useHotkey";
import { useToast } from "./ui/useToast";
import { useUpdater } from "../hooks/useUpdater";
import { useSettings } from "../hooks/useSettings";
import { useAuth } from "../hooks/useAuth";
import { useUsage } from "../hooks/useUsage";
import { useCollapsibleSidebar } from "../hooks/useCollapsibleSidebar";
import {
  useTranscriptions,
  useShowDiscarded,
  initializeTranscriptions,
  removeTranscription as removeFromStore,
  updateTranscription as updateInStore,
  clearTranscriptions as clearStore,
} from "../stores/transcriptionStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  useIsMeetingMode,
  useIsNarrowWindow,
  useMeetingRecordingStore,
} from "../stores/meetingRecordingStore";
import ControlPanelSidebar, {
  CONTROL_PANEL_SIDEBAR_RAIL_WIDTH_PX,
  CONTROL_PANEL_SIDEBAR_WIDTH_PX,
  type ControlPanelView,
} from "./ControlPanelSidebar";
import MeetingRecordingMount from "./MeetingRecordingMount";
import MeetingRecordingPill from "./notes/MeetingRecordingPill";
import WindowControls from "./WindowControls";
import ConnectionStatus from "./ConnectionStatus";
import { Skeleton } from "./ui/skeleton";

import { getCachedPlatform } from "../utils/platform";
import { writeTextToClipboard } from "../utils/writeClipboard";
import {
  setActiveNoteId,
  setActiveFolderId,
  useActiveNoteId,
  initializeNotes,
} from "../stores/noteStore";
import { fetchProviders as fetchStreamingProviders } from "../stores/streamingProvidersStore";
import { executeTranslationChain, shouldRunTranslateStep } from "../helpers/translationChain";
import HistoryView from "./HistoryView";
import BackgroundActionToastListener from "./notes/BackgroundActionToastListener";
import { syncService } from "../services/SyncService.js";
import logger from "../utils/logger";
import AcceptInvitationModal from "./AcceptInvitationModal";
import {
  consumePendingInvitationToken,
  clearPendingInvitationToken,
} from "../utils/pendingInvitationToken";
import { VOICELAB_AI_ENABLED, WORKSPACES_ENABLED } from "../lib/features";

const platform = getCachedPlatform();

// Keep this loader reusable so we can warm the settings chunk after the main
// panel becomes interactive. Opening Settings should never replace the panel
// with a page-level fallback on its first click.
const loadSettingsModal = () => import("./SettingsModal");
const SettingsModal = React.lazy(loadSettingsModal);
const ReferralModal = React.lazy(() => import("./ReferralModal"));
const PersonalNotesView = React.lazy(() => import("./notes/PersonalNotesView"));
const DictionaryView = React.lazy(() => import("./DictionaryView"));
const UploadAudioView = React.lazy(() => import("./notes/UploadAudioView"));
const IntegrationsView = React.lazy(() => import("./IntegrationsView"));
const ChatView = React.lazy(() => import("./chat/ChatView"));
const CommandSearch = React.lazy(() => import("./CommandSearch"));

function PanelLoadingFallback() {
  return (
    <div className="w-full space-y-4 px-4 pt-4" aria-busy="true" aria-label="Loading content">
      <Skeleton className="h-5 w-36" />
      {[0, 1, 2].map((row) => (
        <div key={row} className="rounded-lg border border-border p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function SettingsModalLoadingFallback() {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 backdrop-blur-[2px]"
      aria-busy="true"
      aria-label="Loading settings"
    >
      <div className="flex h-[88vh] w-[92vw] max-w-5xl overflow-hidden rounded-[14px] border border-black/10 bg-white shadow-[0_24px_64px_-20px_rgba(0,0,0,0.3)] dark:border-white/12 dark:bg-[#0f0f0f] dark:shadow-[0_28px_72px_-18px_rgba(0,0,0,0.7)]">
        <aside className="w-60 shrink-0 border-r border-black/10 bg-[#fcfcfb] px-3 pt-5 dark:border-white/12 dark:bg-[#171717]">
          <Skeleton className="mb-5 h-4 w-20" />
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="mb-2 h-9 w-full rounded-lg" />
          ))}
        </aside>
        <div className="min-w-0 flex-1 px-8 py-7">
          <Skeleton className="h-7 w-32" />
          <div className="mt-10 flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-52" />
            </div>
          </div>
          <Skeleton className="mt-8 h-40 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

interface ControlPanelProps {
  /** Open the settings modal at this section on mount (e.g. after onboarding). */
  initialSettingsSection?: string;
}

export default function ControlPanel({ initialSettingsSection }: ControlPanelProps = {}) {
  const { t } = useTranslation();
  const history = useTranscriptions();
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(!!initialSettingsSection);
  const [showPostMigration, setShowPostMigration] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(
    initialSettingsSection
  );
  const [aiCTADismissed, setAiCTADismissed] = useState(
    () => localStorage.getItem("aiCTADismissed") === "true"
  );
  const [showReferrals, setShowReferrals] = useState(false);
  const [invitationToken, setInvitationToken] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const showDiscarded = useShowDiscarded();
  const [showCloudMigrationBanner, setShowCloudMigrationBanner] = useState(false);
  const [savedDictationPage, setSavedDictationPage] = useState(0);
  const [hasMoreSavedDictations, setHasMoreSavedDictations] = useState(false);
  const [isLoadingMoreSavedDictations, setIsLoadingMoreSavedDictations] = useState(false);
  const [savedDictationsError, setSavedDictationsError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ControlPanelView>("home");
  const {
    collapsed: sidebarCollapsed,
    toggle: toggleSidebar,
  } = useCollapsibleSidebar();
  const isMeetingMode = useIsMeetingMode();
  const isNarrowWindow = useIsNarrowWindow();
  const activeNoteId = useActiveNoteId();
  const isSidePanelLayout =
    isMeetingMode || (isNarrowWindow && activeView === "personal-notes" && activeNoteId != null);
  const recordingNoteId = useMeetingRecordingStore((s) => s.recordingNoteId);
  const recordingFolderId = useMeetingRecordingStore((s) => s.recordingFolderId);
  const [meetingRecordingRequest, setMeetingRecordingRequest] = useState<{
    noteId: number;
    folderId: number;
    event: any;
  } | null>(null);
  const [gpuAccelAvailable, setGpuAccelAvailable] = useState(false);
  const [gpuBannerDismissed, setGpuBannerDismissed] = useState(
    () => localStorage.getItem("gpuBannerDismissedUnified") === "true"
  );
  const cloudMigrationProcessed = useRef(false);
  const updateReadyToastShown = useRef(false);
  const updateErrorToastShown = useRef<Error | null>(null);
  const { hotkey } = useHotkey();
  const { toast } = useToast();
  const { useCleanupModel, setUseLocalWhisper, setCloudTranscriptionMode } = useSettings();
  const { isSignedIn, isLoaded: authLoaded, user } = useAuth();

  // Settings is opened often enough to justify warming its small code-split
  // chunk once the primary screen is already usable. The timeout keeps the
  // first render and initial transcription request ahead of this work.
  useEffect(() => {
    if (isLoading) return;
    const timer = window.setTimeout(() => {
      void loadSettingsModal();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [isLoading]);
  const dataRetentionEnabled = useSettingsStore((state) => state.dataRetentionEnabled);
  // One app-level usage owner feeds the sidebar, Account settings, and the
  // optional Integrations view. This prevents each surface from fetching and
  // rebuilding its own usage card when it opens.
  const usage = useUsage({ auth: { isSignedIn, user } });

  const {
    status: updateStatus,
    downloadProgress,
    isDownloading,
    isInstalling,
    downloadUpdate,
    installUpdate,
    error: updateError,
  } = useUpdater();

  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const loadTranscriptions = useCallback(
    async (includeDiscarded?: boolean) => {
      try {
        setIsLoading(true);
        await initializeTranscriptions(undefined, includeDiscarded);
      } catch {
        showAlertDialog({
          title: t("controlPanel.history.couldNotLoadTitle"),
          description: t("controlPanel.history.couldNotLoadDescription"),
        });
      } finally {
        setIsLoading(false);
      }
    },
    [showAlertDialog, t]
  );

  useEffect(() => {
    loadTranscriptions();
  }, [loadTranscriptions]);

  const loadSavedDictations = useCallback(
    async (page: number) => {
      if (
        !authLoaded ||
        !isSignedIn ||
        !dataRetentionEnabled ||
        !window.electronAPI?.desktopListTranscriptions
      ) {
        return;
      }
      setIsLoadingMoreSavedDictations(true);
      setSavedDictationsError(null);
      try {
        const result = await window.electronAPI.desktopListTranscriptions(page, 50);
        if (!result.success) {
          setSavedDictationsError(result.code || "SERVICE_UNAVAILABLE");
          return;
        }
        await initializeTranscriptions(Math.max(50, page * 50), showDiscarded);
        setSavedDictationPage(result.page || page);
        setHasMoreSavedDictations(result.hasMore === true);
      } catch {
        setSavedDictationsError("SERVICE_UNAVAILABLE");
      } finally {
        setIsLoadingMoreSavedDictations(false);
      }
    },
    [authLoaded, dataRetentionEnabled, isSignedIn, showDiscarded]
  );

  useEffect(() => {
    if (activeView !== "home") return;
    void loadSavedDictations(1);
  }, [activeView, loadSavedDictations]);

  useEffect(() => {
    const { noteFilesEnabled, noteFilesPath } = useSettingsStore.getState();
    if (!noteFilesEnabled) return;
    window.electronAPI?.noteFilesSetEnabled?.(true, noteFilesPath || undefined, {
      skipRebuild: true,
    });
  }, []);

  useEffect(() => {
    if (platform !== "darwin") return;
    window.electronAPI?.getPostMigrationState?.().then((state) => {
      if (state?.justMigrated) setShowPostMigration(true);
    });
  }, []);

  const dismissPostMigrationPermanently = useCallback(async () => {
    await window.electronAPI?.markBundleMigrated?.();
    setShowPostMigration(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = platform === "darwin" ? e.metaKey : e.ctrlKey;
      if (mod && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (updateStatus.updateDownloaded && !isDownloading) {
      if (!updateReadyToastShown.current) {
        updateReadyToastShown.current = true;
        toast({
          title: t("controlPanel.update.readyTitle"),
          description: t("controlPanel.update.readyDescription"),
          variant: "success",
        });
      }
    } else {
      updateReadyToastShown.current = false;
    }
  }, [updateStatus.updateDownloaded, isDownloading, toast, t]);

  useEffect(() => {
    if (updateError && updateError !== updateErrorToastShown.current) {
      updateErrorToastShown.current = updateError;
      toast({
        title: t("controlPanel.update.problemTitle"),
        description: t("controlPanel.update.problemDescription"),
        variant: "destructive",
      });
    }
    if (!updateError) {
      updateErrorToastShown.current = null;
    }
  }, [updateError, toast, t]);

  useEffect(() => {
    if (!WORKSPACES_ENABLED) return;
    const unsubscribe = window.electronAPI?.onWorkspaceInvitationToken?.((token) => {
      setInvitationToken(token);
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!WORKSPACES_ENABLED || !authLoaded || !isSignedIn) return;
    const pending = consumePendingInvitationToken();
    if (pending) {
      setInvitationToken(pending);
      clearPendingInvitationToken();
    }
  }, [authLoaded, isSignedIn]);

  useEffect(() => {
    if (!authLoaded || !isSignedIn || cloudMigrationProcessed.current) return;
    const isPending = localStorage.getItem("pendingCloudMigration") === "true";
    const alreadyShown = localStorage.getItem("cloudMigrationShown") === "true";
    if (!isPending || alreadyShown) return;

    cloudMigrationProcessed.current = true;
    setUseLocalWhisper(false);
    setCloudTranscriptionMode("openwhispr");
    localStorage.removeItem("pendingCloudMigration");
    setShowCloudMigrationBanner(true);
  }, [authLoaded, isSignedIn, setUseLocalWhisper, setCloudTranscriptionMode]);

  useEffect(() => {
    if (platform === "darwin" || gpuBannerDismissed) return;
    const detect = async () => {
      let available = false;
      if (useCleanupModel) {
        try {
          const [gpu, vulkan] = await Promise.all([
            window.electronAPI?.detectVulkanGpu?.(),
            window.electronAPI?.getLlamaVulkanStatus?.(),
          ]);
          available = Boolean(gpu?.available && !vulkan?.downloaded);
        } catch {}
      }
      setGpuAccelAvailable(available);
    };
    detect();
  }, [useCleanupModel, gpuBannerDismissed]);

  useEffect(() => {
    const drain = async () => {
      const data = await window.electronAPI?.getPendingMeetingNoteNavigation?.();
      if (!data) return;
      setActiveFolderId(data.folderId);
      setActiveNoteId(data.noteId);
      setActiveView("personal-notes");
      setMeetingRecordingRequest({
        noteId: data.noteId,
        folderId: data.folderId,
        event: data.event,
      });
      initializeNotes(null, 50, data.folderId);
      if (
        data.trigger === "hotkey" &&
        useSettingsStore.getState().meetingHotkeyLayoutMode === "side-panel"
      ) {
        window.electronAPI?.snapToMeetingMode?.();
      }
    };
    drain();
    const cleanup = window.electronAPI?.onMeetingNoteNavigationPending?.(drain);
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    const drain = async () => {
      const data = await window.electronAPI?.getPendingNoteNavigation?.();
      if (!data) return;
      if (data.folderId) {
        setActiveFolderId(data.folderId);
        initializeNotes(null, 50, data.folderId);
      }
      setActiveNoteId(data.noteId);
      setActiveView("personal-notes");
    };
    drain();
    const cleanup = window.electronAPI?.onNoteNavigationPending?.(drain);
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    const cleanup = window.electronAPI?.onShowSettings?.(() => {
      setShowSettings(true);
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    fetchStreamingProviders();
  }, []);

  const handleMeetingRecordingRequestHandled = useCallback(
    () => setMeetingRecordingRequest(null),
    []
  );

  const handleExitMeetingMode = useCallback(() => {
    window.electronAPI?.restoreFromMeetingMode?.();
  }, []);

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        await writeTextToClipboard(text);
        return true;
      } catch (err) {
        toast({
          title: t("controlPanel.history.couldNotCopyTitle"),
          description: t("controlPanel.history.couldNotCopyDescription"),
          variant: "destructive",
        });
        return false;
      }
    },
    [toast, t]
  );

  const deleteTranscription = useCallback(
    async (id: number) => {
      showConfirmDialog({
        title: t("controlPanel.history.deleteTitle"),
        description: t("controlPanel.history.deleteDescription"),
        onConfirm: async () => {
          try {
            const result = await window.electronAPI.deleteTranscription(id);
            if (result.success) {
              removeFromStore(id);
              syncService.requestSyncAll("manual");
            } else {
              showAlertDialog({
                title: t("controlPanel.history.couldNotDeleteTitle"),
                description: t("controlPanel.history.couldNotDeleteDescription"),
              });
            }
          } catch {
            showAlertDialog({
              title: t("controlPanel.history.couldNotDeleteTitle"),
              description: t("controlPanel.history.couldNotDeleteDescriptionGeneric"),
            });
          }
        },
        variant: "destructive",
      });
    },
    [showConfirmDialog, showAlertDialog, t]
  );

  const clearAllTranscriptions = useCallback(() => {
    showConfirmDialog({
      title: t("controlPanel.history.clearAllTitle"),
      description: t("controlPanel.history.clearAllDescription"),
      onConfirm: async () => {
        try {
          const result = await window.electronAPI.clearTranscriptions();
          if (result.success) {
            clearStore();
            syncService.requestSyncAll("manual");
            toast({
              title: t("controlPanel.history.clearAllSuccess"),
              variant: "success",
              duration: 2000,
            });
          } else {
            showAlertDialog({
              title: t("controlPanel.history.clearAllErrorTitle"),
              description: t("controlPanel.history.clearAllErrorDescription"),
            });
          }
        } catch {
          showAlertDialog({
            title: t("controlPanel.history.clearAllErrorTitle"),
            description: t("controlPanel.history.clearAllErrorDescription"),
          });
        }
      },
      variant: "destructive",
    });
  }, [showConfirmDialog, showAlertDialog, toast, t]);

  const showAudioInFolder = useCallback(
    async (id: number) => {
      try {
        const result = await window.electronAPI.showAudioInFolder(id);
        if (!result?.success) {
          toast({
            title: t("controlPanel.history.audioNotFound"),
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: t("controlPanel.history.audioNotFound"),
          variant: "destructive",
        });
      }
    },
    [toast, t]
  );

  const retryTranscription = useCallback(
    async (id: number, options?: { isRecover?: boolean }) => {
      try {
        const s = useSettingsStore.getState();
        const result = await window.electronAPI.retryTranscription(id, {
          preferredLanguage: s.preferredLanguage,
        });
        if (result.success && result.transcription) {
          const rawText = result.transcription.text;
          let finalTranscription = result.transcription;

          // A translation dictation must re-run cleanup-then-translate on retry, not plain cleanup.
          let handledTranslation = false;
          if (result.transcription.route_kind === "translation") {
            handledTranslation = true;
            try {
              const [
                { default: ReasoningService },
                { resolveReasoningRoute },
                { getEffectiveCleanupModel },
              ] = await Promise.all([
                import("../services/ReasoningService"),
                import("../helpers/audioManager"),
                import("../stores/settingsStore"),
              ]);
              const settings = useSettingsStore.getState();
              const agentName = localStorage.getItem("agentName") || null;
              const route = resolveReasoningRoute(rawText, settings, agentName, false, true);
              if (route.kind === "translation") {
                const { text } = await executeTranslationChain({
                  text: rawText,
                  cleanupReachable: route.cleanupReachable,
                  runCleanup: (currentText: string) =>
                    ReasoningService.processText(
                      currentText,
                      getEffectiveCleanupModel(),
                      agentName,
                      route.cleanupConfig
                    ),
                  runTranslate: (currentText: string) =>
                    ReasoningService.processText(currentText, route.model, agentName, route.config),
                  shouldTranslate: shouldRunTranslateStep(
                    settings.translationSourceLanguage,
                    settings.translationTargetLanguage
                  ),
                  onCleanupError: (cleanupError: Error) =>
                    logger.warn(
                      "Cleanup step failed in translation chain, translating raw transcript",
                      { error: cleanupError.message },
                      "transcription"
                    ),
                  onEmptyTranslate: () =>
                    logger.warn(
                      "Translation step returned empty text, keeping previous text",
                      {},
                      "transcription"
                    ),
                });
                if (text !== rawText) {
                  const updated = await window.electronAPI.updateTranscriptionText(
                    id,
                    text,
                    rawText
                  );
                  if (updated.success && updated.transcription) {
                    finalTranscription = updated.transcription;
                  }
                }
              } else {
                // Translation disabled/unreachable since recording — fall through to cleanup.
                handledTranslation = false;
              }
            } catch {
              // Reasoning failed — keep the raw STT result
            }
          }

          // Apply AI reasoning if enabled
          if (!handledTranslation && useCleanupModel) {
            try {
              const [
                { default: ReasoningService },
                { getEffectiveCleanupModel, isCloudCleanupMode, getSettings },
              ] = await Promise.all([
                import("../services/ReasoningService"),
                import("../stores/settingsStore"),
              ]);
              const model = getEffectiveCleanupModel();
              const isCloud = isCloudCleanupMode();
              if (model || isCloud) {
                const agentName = localStorage.getItem("agentName") || null;
                const reasonedText = await ReasoningService.processText(rawText, model, agentName, {
                  disableThinking: getSettings().cleanupDisableThinking,
                });
                if (reasonedText && reasonedText !== rawText) {
                  const updated = await window.electronAPI.updateTranscriptionText(
                    id,
                    reasonedText,
                    rawText
                  );
                  if (updated.success && updated.transcription) {
                    finalTranscription = updated.transcription;
                  }
                }
              }
            } catch {
              // Reasoning failed — keep the raw STT result
            }
          }

          updateInStore(finalTranscription);
          toast({
            title: t(
              options?.isRecover
                ? "controlPanel.history.discarded.recovered"
                : "controlPanel.history.retrySuccess"
            ),
          });
        } else {
          toast({
            title: t("controlPanel.history.retryError"),
            description: result.error,
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: t("controlPanel.history.retryError"),
          variant: "destructive",
        });
      }
    },
    [toast, t, useCleanupModel]
  );

  const toggleShowDiscarded = useCallback(() => {
    loadTranscriptions(!showDiscarded);
  }, [loadTranscriptions, showDiscarded]);

  const handleUpdateClick = async () => {
    if (updateStatus.updateDownloaded) {
      showConfirmDialog({
        title: t("controlPanel.update.installTitle"),
        description: t("controlPanel.update.installDescription"),
        onConfirm: async () => {
          try {
            await installUpdate();
          } catch (error) {
            toast({
              title: t("controlPanel.update.couldNotInstallTitle"),
              description: t("controlPanel.update.couldNotInstallDescription"),
              variant: "destructive",
            });
          }
        },
      });
    } else if (updateStatus.updateAvailable && !isDownloading) {
      try {
        await downloadUpdate();
      } catch (error) {
        toast({
          title: t("controlPanel.update.couldNotDownloadTitle"),
          description: t("controlPanel.update.couldNotDownloadDescription"),
          variant: "destructive",
        });
      }
    }
  };

  return (
    <div className="h-screen bg-background flex flex-col">
      <ConnectionStatus />
      <MeetingRecordingMount />
      <MeetingRecordingPill
        activeView={activeView}
        activeNoteId={activeNoteId}
        onReturnToNote={() => {
          setActiveView("personal-notes");
          setActiveFolderId(recordingFolderId);
          setActiveNoteId(recordingNoteId);
        }}
      />
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={hideConfirmDialog}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={hideAlertDialog}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      <PostMigrationOnboarding
        open={showPostMigration}
        onOpenChange={setShowPostMigration}
        onDone={dismissPostMigrationPermanently}
      />

      {showSettings && (
        <Suspense fallback={<SettingsModalLoadingFallback />}>
          <SettingsModal
            open={showSettings}
            onOpenChange={(open) => {
              setShowSettings(open);
              if (!open) setSettingsSection(undefined);
            }}
            initialSection={settingsSection}
            auth={{ isSignedIn, isLoaded: authLoaded, user }}
            usageState={usage}
          />
        </Suspense>
      )}

      {showReferrals && (
        <Suspense fallback={<PanelLoadingFallback />}>
          <ReferralModal open={showReferrals} onOpenChange={setShowReferrals} />
        </Suspense>
      )}

      {WORKSPACES_ENABLED && (
        <AcceptInvitationModal
          token={invitationToken}
          onClose={() => setInvitationToken(null)}
          isSignedIn={isSignedIn}
          onSignIn={() => {
            setInvitationToken(null);
          }}
        />
      )}

      {showSearch && (
        <Suspense fallback={<PanelLoadingFallback />}>
          <CommandSearch
            open={showSearch}
            onOpenChange={setShowSearch}
            transcriptions={history}
            onNoteSelect={(id, folderId) => {
              if (folderId) setActiveFolderId(folderId);
              setActiveNoteId(id);
              setActiveView("personal-notes");
            }}
            onTranscriptSelect={() => {
              setActiveView("home");
            }}
          />
        </Suspense>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        <div
          className="shrink-0 transition-[width] duration-200 ease-out"
          style={{
            width: isSidePanelLayout
              ? 0
              : sidebarCollapsed
                ? CONTROL_PANEL_SIDEBAR_RAIL_WIDTH_PX
                : CONTROL_PANEL_SIDEBAR_WIDTH_PX,
          }}
        />
        <div
          className="absolute inset-y-0 left-0 z-30 transition-[width,transform] duration-200 ease-out"
          style={{
            width: sidebarCollapsed
              ? CONTROL_PANEL_SIDEBAR_RAIL_WIDTH_PX
              : CONTROL_PANEL_SIDEBAR_WIDTH_PX,
            transform: isSidePanelLayout ? "translateX(-100%)" : "translateX(0)",
          }}
        >
          <ControlPanelSidebar
            activeView={activeView}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebar}
            onViewChange={setActiveView}
            onOpenSearch={() => setShowSearch(true)}
            onOpenSettings={() => {
              setSettingsSection(undefined);
              setShowSettings(true);
            }}
            userName={user?.name}
            userImage={user?.image}
            isSignedIn={isSignedIn}
            authLoaded={authLoaded}
            usageState={usage}
            updateAction={
              !updateStatus.isDevelopment &&
              (updateStatus.updateAvailable ||
                updateStatus.updateDownloaded ||
                isDownloading ||
                isInstalling)
                ? {
                    label: updateStatus.updateDownloaded
                      ? t("controlPanel.update.installButton")
                      : t("controlPanel.update.availableButton"),
                    progress: updateStatus.updateDownloaded || isInstalling ? 100 : downloadProgress,
                    disabled: isInstalling,
                    onClick: () => void handleUpdateClick(),
                  }
                : undefined
            }
          />
        </div>
        <main className="flex-1 flex flex-col overflow-hidden">
          {(isSidePanelLayout || platform !== "darwin") && (
            <div
              className="flex h-12 w-full shrink-0 items-center justify-between border-b border-black/10 bg-white dark:border-white/12 dark:bg-[#0f0f0f]"
              style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            >
              {isSidePanelLayout && (
                <div
                  className={platform === "darwin" ? "ml-[84px] mt-[16px]" : "ml-2"}
                  style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                >
                  <Button
                    variant="outline-flat"
                    size="sm"
                    onClick={handleExitMeetingMode}
                    className="h-7 px-2.5 pl-1.5 gap-1"
                  >
                    <ChevronLeft size={14} strokeWidth={1.8} />
                    {t("controlPanel.backToNotes")}
                  </Button>
                </div>
              )}
              <div className="flex-1" />
              {platform !== "darwin" && (
                <div
                  className="pr-1"
                  style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                >
                  <WindowControls />
                </div>
              )}
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {gpuAccelAvailable && activeView === "home" && !gpuBannerDismissed && (
              <div className="max-w-3xl mx-auto w-full mb-3">
                <div className="rounded-lg border border-primary/20 dark:border-primary/15 bg-primary/5 p-3">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-md bg-primary/10 dark:bg-primary/15 flex items-center justify-center">
                      <Zap size={16} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground mb-0.5">
                        {t("controlPanel.gpu.bannerTitle")}
                      </p>
                      <p className="text-xs text-muted-foreground mb-2">
                        {t("controlPanel.gpu.bannerDescription")}
                      </p>
                      <div className="flex items-center gap-3">
                        <Button
                          variant="default"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setSettingsSection("intelligence");
                            setShowSettings(true);
                          }}
                        >
                          {t("controlPanel.gpu.enableButton")}
                        </Button>
                        <button
                          onClick={() => {
                            setGpuBannerDismissed(true);
                            localStorage.setItem("gpuBannerDismissedUnified", "true");
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {t("controlPanel.gpu.dismissButton")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {activeView === "home" && (
              <HistoryView
                history={history}
                isLoading={isLoading}
                hotkey={hotkey}
                showCloudMigrationBanner={showCloudMigrationBanner}
                setShowCloudMigrationBanner={setShowCloudMigrationBanner}
                aiCTADismissed={aiCTADismissed}
                setAiCTADismissed={setAiCTADismissed}
                useCleanupModel={useCleanupModel}
                copyToClipboard={copyToClipboard}
                deleteTranscription={deleteTranscription}
                clearAllTranscriptions={clearAllTranscriptions}
                onShowAudioInFolder={showAudioInFolder}
                onRetryTranscription={retryTranscription}
                showDiscarded={showDiscarded}
                onToggleDiscarded={toggleShowDiscarded}
                hasMoreSavedDictations={hasMoreSavedDictations}
                isLoadingMoreSavedDictations={isLoadingMoreSavedDictations}
                savedDictationsError={savedDictationsError}
                onRetrySavedDictations={() => void loadSavedDictations(1)}
                onLoadMoreSavedDictations={() => void loadSavedDictations(savedDictationPage + 1)}
                onUpdateTranscription={updateInStore}
                onRemoveTranscription={removeFromStore}
                onOpenSettings={(section) => {
                  setSettingsSection(section);
                  setShowSettings(true);
                }}
              />
            )}
            {VOICELAB_AI_ENABLED && activeView === "chat" && (
              <Suspense fallback={<PanelLoadingFallback />}>
                <ChatView />
              </Suspense>
            )}
            {activeView === "personal-notes" && (
              <Suspense fallback={<PanelLoadingFallback />}>
                <PersonalNotesView
                  onOpenSettings={(section) => {
                    setSettingsSection(section);
                    setShowSettings(true);
                  }}
                  onOpenSearch={() => setShowSearch(true)}
                  meetingRecordingRequest={meetingRecordingRequest}
                  onMeetingRecordingRequestHandled={handleMeetingRecordingRequestHandled}
                />
              </Suspense>
            )}
            {activeView === "dictionary" && (
              <Suspense fallback={<PanelLoadingFallback />}>
                <DictionaryView />
              </Suspense>
            )}
            {activeView === "upload" && (
              <Suspense fallback={<PanelLoadingFallback />}>
                <UploadAudioView
                  onNoteCreated={(noteId, folderId) => {
                    setActiveNoteId(noteId);
                    if (folderId) setActiveFolderId(folderId);
                    setActiveView("personal-notes");
                  }}
                  onOpenSettings={(section) => {
                    setSettingsSection(section);
                    setShowSettings(true);
                  }}
                />
              </Suspense>
            )}
            {activeView === "integrations" && (
              <Suspense fallback={<PanelLoadingFallback />}>
                <IntegrationsView
                  isPaid={!!usage?.isSubscribed}
                  onUpgrade={() => {
                    setSettingsSection("account");
                    setShowSettings(true);
                  }}
                />
              </Suspense>
            )}
          </div>
        </main>
      </div>
      <BackgroundActionToastListener />
    </div>
  );
}
