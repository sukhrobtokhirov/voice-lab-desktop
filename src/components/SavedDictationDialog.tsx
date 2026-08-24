import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2 } from "lucide-react";
import type { TranscriptionItem } from "../types/electron";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import AudioWaveformPlayer from "./ui/AudioWaveformPlayer";

interface SavedDictationDialogProps {
  item: TranscriptionItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (item: TranscriptionItem) => void;
  onRemoved: (id: number) => void;
}

type DialogError = "invalid" | "conflict" | "notFound" | "unavailable" | null;

export default function SavedDictationDialog({
  item,
  open,
  onOpenChange,
  onUpdated,
  onRemoved,
}: SavedDictationDialogProps) {
  const { t } = useTranslation();
  const desktopId = item?.desktop_transcription_id ?? null;
  const localId = item?.id ?? null;
  const [record, setRecord] = useState<TranscriptionItem | null>(item);
  const [draft, setDraft] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<DialogError>(null);
  const refreshedAudioRef = useRef(false);
  const openedDesktopIdRef = useRef<string | null>(null);

  const load = useCallback(async ({ refreshAudio = false } = {}) => {
    if (!desktopId || !window.electronAPI?.desktopGetTranscription) return;
    if (!refreshAudio) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const result = await window.electronAPI.desktopGetTranscription(desktopId);
      if (result.success && result.transcription) {
        if (!refreshAudio) {
          setRecord(result.transcription);
          setDraft(result.transcription.text);
          onUpdated(result.transcription);
        }
        setAudioUrl(result.audioUrl || null);
        setAudioUnavailable(false);
        return;
      }
      if (result.code === "DESKTOP_TRANSCRIPTION_NOT_FOUND") {
        if (localId != null) onRemoved(localId);
        setError("notFound");
      } else {
        setError("unavailable");
      }
    } catch {
      setError("unavailable");
    } finally {
      if (!refreshAudio) setIsLoading(false);
    }
  }, [desktopId, localId, onRemoved, onUpdated]);

  useEffect(() => {
    if (!open || !item || !desktopId) {
      openedDesktopIdRef.current = null;
      return;
    }
    if (openedDesktopIdRef.current === desktopId) return;
    openedDesktopIdRef.current = desktopId;
    refreshedAudioRef.current = false;
    setRecord(item);
    setDraft(item.text);
    setAudioUrl(null);
    setAudioUnavailable(false);
    void load();
  }, [desktopId, item, load, open]);

  const handleAudioError = () => {
    if (refreshedAudioRef.current) {
      setAudioUnavailable(true);
      return;
    }
    // Signed URLs have a ten-minute lifetime. Re-read once for a fresh URL.
    refreshedAudioRef.current = true;
    void load({ refreshAudio: true });
  };

  const save = async () => {
    const desktopId = record?.desktop_transcription_id;
    const revision = record?.desktop_revision;
    if (!desktopId || !revision) return;
    if (!draft.trim()) {
      setError("invalid");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI?.desktopUpdateTranscription?.(
        desktopId,
        draft,
        revision
      );
      if (result?.success && result.transcription) {
        onUpdated(result.transcription);
        onOpenChange(false);
        return;
      }
      if (result?.code === "DESKTOP_TRANSCRIPT_CONFLICT" && result.transcription) {
        setRecord(result.transcription);
        setDraft(result.transcription.text);
        onUpdated(result.transcription);
        setError("conflict");
      } else if (result?.code === "DESKTOP_TRANSCRIPTION_NOT_FOUND") {
        if (localId != null) onRemoved(localId);
        setError("notFound");
      } else if (result?.code === "VALIDATION_ERROR") {
        setError("invalid");
      } else {
        setError("unavailable");
      }
    } catch {
      setError("unavailable");
    } finally {
      setIsSaving(false);
    }
  };

  if (!item?.desktop_transcription_id) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-5 border-white/10 bg-background/88 p-5 backdrop-blur-2xl dark:bg-[#171717]/88">
        <DialogHeader className="pr-8">
          <DialogTitle>{t("controlPanel.history.savedDictation.title")}</DialogTitle>
          <DialogDescription>{t("controlPanel.history.savedDictation.description")}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("controlPanel.history.savedDictation.loading")}
          </div>
        ) : (
          <div className="space-y-4">
            {record?.desktop_audio_available === 1 && (
              <div>
                {audioUrl ? (
                  <AudioWaveformPlayer
                    src={audioUrl}
                    fallbackDurationSeconds={
                      record.audio_duration_ms ? record.audio_duration_ms / 1000 : null
                    }
                    onSourceError={handleAudioError}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("controlPanel.history.savedDictation.audioUnavailable")}
                  </p>
                )}
                {audioUnavailable && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("controlPanel.history.savedDictation.audioUnavailable")}
                  </p>
                )}
              </div>
            )}

            <Textarea
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (error) setError(null);
              }}
              aria-label={t("controlPanel.history.savedDictation.title")}
              className="min-h-40 resize-y rounded-xl border-white/10 bg-foreground/[0.035] text-foreground shadow-none focus:border-ring/50 focus:ring-ring/20 dark:border-white/10 dark:bg-white/[0.035] dark:focus:border-ring/50"
            />

            {error && (
              <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground" role="status">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{t(`controlPanel.history.savedDictation.${error}`)}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {error === "unavailable" && !isLoading ? (
            <Button variant="outline" onClick={() => void load()}>
              {t("controlPanel.history.savedDictation.retry")}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
          )}
          <Button
            onClick={() => void save()}
            disabled={isLoading || isSaving || error === "notFound" || error === "unavailable"}
          >
            {isSaving && <Loader2 className="size-3.5 animate-spin" />}
            {t(isSaving ? "controlPanel.history.savedDictation.saving" : "controlPanel.history.savedDictation.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
