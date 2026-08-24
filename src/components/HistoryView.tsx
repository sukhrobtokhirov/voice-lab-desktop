import { Fragment, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Sparkles, Cloud, X, Mic, Trash2, Archive } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import TranscriptionItem from "./ui/TranscriptionItem";
import type { TranscriptionItem as TranscriptionItemType } from "../types/electron";
import { formatHotkeyLabel, parseHotkeyList } from "../utils/hotkeys";
import { formatDateGroup } from "../utils/dateFormatting";
import { cn } from "./lib/utils";
import { useUpcomingEvents } from "../hooks/useUpcomingEvents";
import UpcomingMeetings from "./UpcomingMeetings";
import { useSettingsStore } from "../stores/settingsStore";
import { VOICELAB_AI_ENABLED } from "../lib/features";
import SavedDictationDialog from "./SavedDictationDialog";

interface HistoryViewProps {
  history: TranscriptionItemType[];
  isLoading: boolean;
  hotkey: string;
  showCloudMigrationBanner: boolean;
  setShowCloudMigrationBanner: (show: boolean) => void;
  aiCTADismissed: boolean;
  setAiCTADismissed: (dismissed: boolean) => void;
  useCleanupModel: boolean;
  copyToClipboard: (text: string) => Promise<boolean>;
  deleteTranscription: (id: number) => void;
  clearAllTranscriptions: () => void;
  onOpenSettings: (section?: string) => void;
  onShowAudioInFolder: (id: number) => void;
  onRetryTranscription: (id: number, options?: { isRecover?: boolean }) => Promise<void>;
  showDiscarded: boolean;
  onToggleDiscarded: () => void;
  hasMoreSavedDictations: boolean;
  isLoadingMoreSavedDictations: boolean;
  savedDictationsError: string | null;
  onRetrySavedDictations: () => void;
  onLoadMoreSavedDictations: () => void;
  onUpdateTranscription: (item: TranscriptionItemType) => void;
  onRemoveTranscription: (id: number) => void;
}

function TranscriptionHistorySkeleton() {
  return (
    <div className="space-y-1.5" aria-busy="true" aria-label="Loading transcriptions">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="rounded-lg border border-border bg-card/50 px-4 py-3.5">
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export default function HistoryView({
  history,
  isLoading,
  hotkey,
  showCloudMigrationBanner,
  setShowCloudMigrationBanner,
  aiCTADismissed,
  setAiCTADismissed,
  useCleanupModel,
  copyToClipboard,
  deleteTranscription,
  clearAllTranscriptions,
  onOpenSettings,
  onShowAudioInFolder,
  onRetryTranscription,
  showDiscarded,
  onToggleDiscarded,
  hasMoreSavedDictations,
  isLoadingMoreSavedDictations,
  savedDictationsError,
  onRetrySavedDictations,
  onLoadMoreSavedDictations,
  onUpdateTranscription,
  onRemoveTranscription,
}: HistoryViewProps) {
  const { t } = useTranslation();
  const dataRetentionEnabled = useSettingsStore((s) => s.dataRetentionEnabled);
  const { events, isLoading: eventsLoading, isConnected } = useUpcomingEvents();
  const [editingItem, setEditingItem] = useState<TranscriptionItemType | null>(null);
  const handleSavedDictationUpdated = useCallback(
    (item: TranscriptionItemType) => onUpdateTranscription(item),
    [onUpdateTranscription]
  );
  const handleSavedDictationRemoved = useCallback(
    (id: number) => {
      onRemoveTranscription(id);
      setEditingItem(null);
    },
    [onRemoveTranscription]
  );

  const groupedHistory = useMemo(() => {
    if (history.length === 0) return [];

    const groups: { label: string; items: TranscriptionItemType[] }[] = [];
    let currentLabel: string | null = null;

    for (const item of history) {
      const label = formatDateGroup(item.timestamp, t);

      if (label !== currentLabel) {
        groups.push({ label, items: [item] });
        currentLabel = label;
      } else {
        groups[groups.length - 1].items.push(item);
      }
    }

    return groups;
  }, [history, t]);

  const discardedToggle = (
    <button
      onClick={onToggleDiscarded}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs text-muted-foreground/60 hover:!text-foreground hover:!bg-black/5 dark:hover:!bg-white/5 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30 transition-all duration-200"
    >
      <Archive size={11} />
      <span>
        {showDiscarded
          ? t("controlPanel.history.discarded.hide")
          : t("controlPanel.history.discarded.show")}
      </span>
    </button>
  );

  return (
    <div className="px-4 pt-4 pb-6">
      <div className={cn("mx-auto", isConnected ? "max-w-5xl" : "max-w-3xl")}>
        {history.length === 0 && <div className="mb-2 flex justify-end">{discardedToggle}</div>}
        {showCloudMigrationBanner && (
          <div className="mb-3 relative rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 p-3">
            <button
              onClick={() => {
                setShowCloudMigrationBanner(false);
                localStorage.setItem("cloudMigrationShown", "true");
              }}
              aria-label={t("common.close")}
              className="absolute top-2 right-2 p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              <X size={14} />
            </button>
            <div className="flex items-start gap-3 pr-6">
              <div className="shrink-0 w-8 h-8 rounded-md bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                <Cloud size={16} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground mb-0.5">
                  {t("controlPanel.cloudMigration.title")}
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("controlPanel.cloudMigration.description")}
                </p>
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setShowCloudMigrationBanner(false);
                    localStorage.setItem("cloudMigrationShown", "true");
                    onOpenSettings("transcription");
                  }}
                >
                  {t("controlPanel.cloudMigration.viewSettings")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {VOICELAB_AI_ENABLED && !useCleanupModel && !aiCTADismissed && (
          <div className="mb-3 relative rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 p-3">
            <button
              onClick={() => {
                localStorage.setItem("aiCTADismissed", "true");
                setAiCTADismissed(true);
              }}
              aria-label={t("common.close")}
              className="absolute top-2 right-2 p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              <X size={14} />
            </button>
            <div className="flex items-start gap-3 pr-6">
              <div className="shrink-0 w-8 h-8 rounded-md bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                <Sparkles size={16} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground mb-0.5">
                  {t("controlPanel.aiCta.title")}
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("controlPanel.aiCta.description")}
                </p>
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onOpenSettings("intelligence")}
                >
                  {t("controlPanel.aiCta.enable")}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className={cn(isConnected ? "flex gap-6" : "")}>
          <div className={cn("min-w-0", isConnected ? "flex-1" : "w-full")}>
            {isConnected && (
              <div className="flex items-center gap-1.5 pb-2.5">
                <Mic size={12} className="text-muted-foreground" />
                <span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t("upcoming.transcriptions")}
                </span>
              </div>
            )}
            {!dataRetentionEnabled && (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10 px-3.5 py-2.5 flex items-center gap-2.5">
                <span className="text-amber-600 dark:text-amber-400 shrink-0 text-sm">⊘</span>
                <p className="text-xs text-amber-700 dark:text-amber-300/90 leading-relaxed">
                  {t("controlPanel.history.dataRetentionDisabled")}
                </p>
              </div>
            )}
            {isLoading && history.length === 0 ? (
              <TranscriptionHistorySkeleton />
            ) : history.length === 0 ? (
              <div className="rounded-lg border border-border bg-card/50 dark:bg-card/60 backdrop-blur-sm">
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <svg
                    className="text-foreground dark:text-white mb-5"
                    width="64"
                    height="64"
                    viewBox="0 0 64 64"
                    fill="none"
                  >
                    <rect
                      x="24"
                      y="6"
                      width="16"
                      height="28"
                      rx="8"
                      fill="currentColor"
                      fillOpacity={0.04}
                      stroke="currentColor"
                      strokeOpacity={0.1}
                    />
                    <rect
                      x="28"
                      y="12"
                      width="8"
                      height="3"
                      rx="1.5"
                      fill="currentColor"
                      fillOpacity={0.06}
                    />
                    <path
                      d="M18 28c0 7.7 6.3 14 14 14s14-6.3 14-14"
                      fill="none"
                      stroke="currentColor"
                      strokeOpacity={0.07}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    <line
                      x1="32"
                      y1="42"
                      x2="32"
                      y2="50"
                      stroke="currentColor"
                      strokeOpacity={0.07}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    <line
                      x1="26"
                      y1="50"
                      x2="38"
                      y2="50"
                      stroke="currentColor"
                      strokeOpacity={0.07}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    <path
                      d="M12 20a2 2 0 0 1 0 8"
                      stroke="currentColor"
                      strokeOpacity={0.04}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    <path
                      d="M8 18a2 2 0 0 1 0 12"
                      stroke="currentColor"
                      strokeOpacity={0.03}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    <path
                      d="M52 20a2 2 0 0 0 0 8"
                      stroke="currentColor"
                      strokeOpacity={0.04}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    <path
                      d="M56 18a2 2 0 0 0 0 12"
                      stroke="currentColor"
                      strokeOpacity={0.03}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                  </svg>
                  <h3 className="mb-2 text-sm font-semibold text-foreground/80 dark:text-foreground/80">
                    {t("controlPanel.history.empty")}
                  </h3>
                  <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-foreground/65 dark:text-foreground/65">
                    <span>{t("controlPanel.history.press")}</span>
                    {parseHotkeyList(hotkey).map((hk, index) => (
                      <Fragment key={hk}>
                        {index > 0 && <span className="text-foreground/30">/</span>}
                        <kbd className="inline-flex items-center h-5 px-1.5 rounded-sm bg-surface-1 dark:bg-white/6 border border-border/50 text-xs font-mono font-medium text-foreground/60 dark:text-foreground/40">
                          {formatHotkeyLabel(hk)}
                        </kbd>
                      </Fragment>
                    ))}
                    <span>{t("controlPanel.history.toStart")}</span>
                  </div>
                  {savedDictationsError && (
                    <div className="mt-5 flex flex-col items-center gap-2 text-center">
                      <p className="text-xs text-muted-foreground">
                        {t("controlPanel.history.savedDictation.unavailable")}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isLoadingMoreSavedDictations}
                        onClick={onRetrySavedDictations}
                        className="text-muted-foreground hover:bg-transparent hover:text-foreground"
                      >
                        {isLoadingMoreSavedDictations && (
                          <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        )}
                        {t("controlPanel.history.savedDictation.retry")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="group">
                {groupedHistory.map((group, index) => (
                  <div key={group.label} className={index > 0 ? "mt-4" : ""}>
                    <div className="sticky -top-1 z-10 -mx-4 px-5 pt-2 pb-2 bg-background flex items-center justify-between">
                      <span className="text-2xs font-semibold text-muted-foreground dark:text-muted-foreground uppercase tracking-wide">
                        {group.label}
                      </span>
                      {index === 0 && (
                        <div className="flex items-center gap-1.5">
                          {discardedToggle}
                          <button
                            onClick={clearAllTranscriptions}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs text-muted-foreground/60 hover:!text-destructive hover:!bg-destructive/8 dark:hover:!bg-destructive/10 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30 transition-all duration-200"
                          >
                            <Trash2 size={11} />
                            <span>{t("controlPanel.history.clearAll")}</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5 relative z-0">
                      {group.items.map((item) => (
                        <TranscriptionItem
                          key={item.id}
                          item={item}
                          onCopy={copyToClipboard}
                          onDelete={deleteTranscription}
                          onShowAudioInFolder={onShowAudioInFolder}
                          onRetryTranscription={onRetryTranscription}
                          onOpenSettings={() => onOpenSettings("transcription")}
                          onEdit={setEditingItem}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {(savedDictationsError || hasMoreSavedDictations) && (
                  <div className="flex justify-center pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isLoadingMoreSavedDictations}
                      onClick={savedDictationsError ? onRetrySavedDictations : onLoadMoreSavedDictations}
                      className="text-muted-foreground hover:bg-transparent hover:text-foreground"
                    >
                      {isLoadingMoreSavedDictations && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                      {savedDictationsError
                        ? t("controlPanel.history.savedDictation.retry")
                        : t("controlPanel.history.savedDictation.loadMore")}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {isConnected && (
            <div className="w-64 shrink-0 hidden sm:block">
              <div className="sticky top-4">
                <UpcomingMeetings events={events} isLoading={eventsLoading} />
              </div>
            </div>
          )}
        </div>
      </div>
      <SavedDictationDialog
        item={editingItem}
        open={editingItem !== null}
        onOpenChange={(open) => {
          if (!open) setEditingItem(null);
        }}
        onUpdated={handleSavedDictationUpdated}
        onRemoved={handleSavedDictationRemoved}
      />
    </div>
  );
}
