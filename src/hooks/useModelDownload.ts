import { useState, useCallback, useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useDialogs } from "./useDialogs";
import { useToast } from "../components/ui/useToast";
import type {
  LocalLLMDownloadProgressEvent,
  LocalLLMModelStatus,
} from "../types/electron";
import "../types/electron";

const PROGRESS_THROTTLE_MS = 100;

export interface DownloadProgress {
  percentage: number;
  downloadedBytes: number;
  totalBytes: number;
  speed?: number;
  eta?: number;
}

export type ModelType = "llm";

interface UseModelDownloadOptions {
  modelType: ModelType;
  onDownloadComplete?: () => void;
  onModelsCleared?: () => void;
}

interface ModelDownloadTerminalEvent {
  type: "complete" | "error";
  modelId: string;
  error?: string;
  code?: string;
}

interface PendingModelDownloadRequest {
  modelId: string;
  terminalEvent?: ModelDownloadTerminalEvent;
}

export function formatETA(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function getDownloadErrorMessage(t: TFunction, error: string, code?: string): string {
  if (code === "EXTRACTION_FAILED" || error.includes("installation failed"))
    return t("hooks.modelDownload.errors.extractionFailed");
  if (code === "TLS_ERROR" || error.includes("certificate") || error.includes("issuer"))
    return t("hooks.modelDownload.errors.tlsError");
  if (code === "ETIMEDOUT" || error.includes("timeout") || error.includes("stalled"))
    return t("hooks.modelDownload.errors.timeout");
  if (code === "ENOTFOUND" || error.includes("ENOTFOUND"))
    return t("hooks.modelDownload.errors.notFound");
  if (error.includes("disk space")) return error;
  if (error.includes("corrupted") || error.includes("incomplete") || error.includes("too small"))
    return t("hooks.modelDownload.errors.corrupted");
  if (error.includes("HTTP 429") || error.includes("rate limit"))
    return t("hooks.modelDownload.errors.rateLimited");
  if (error.includes("HTTP 4") || error.includes("HTTP 5"))
    return t("hooks.modelDownload.errors.server", { error });
  return t("hooks.modelDownload.errors.generic", { error });
}

export function useModelDownload({
  modelType,
  onDownloadComplete,
  onModelsCleared,
}: UseModelDownloadOptions) {
  const { t } = useTranslation();
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    percentage: 0,
    downloadedBytes: 0,
    totalBytes: 0,
  });
  const [isCancelling, setIsCancelling] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const isCancellingRef = useRef(false);
  const lastProgressUpdateRef = useRef(0);
  const downloadingModelRef = useRef<string | null>(null);
  const downloadStateVersionRef = useRef(0);
  const activeDownloadRequestRef = useRef<PendingModelDownloadRequest | null>(null);

  const { showAlertDialog } = useDialogs();
  const { toast } = useToast();
  const showAlertDialogRef = useRef(showAlertDialog);
  const onDownloadCompleteRef = useRef(onDownloadComplete);
  const onModelsClearedRef = useRef(onModelsCleared);

  useEffect(() => {
    showAlertDialogRef.current = showAlertDialog;
  }, [showAlertDialog]);

  useEffect(() => {
    onDownloadCompleteRef.current = onDownloadComplete;
  }, [onDownloadComplete]);

  useEffect(() => {
    onModelsClearedRef.current = onModelsCleared;
  }, [onModelsCleared]);

  useEffect(() => {
    downloadingModelRef.current = downloadingModel;
  }, [downloadingModel]);

  useEffect(() => {
    const handleModelsCleared = () => onModelsClearedRef.current?.();
    window.addEventListener("openwhispr-models-cleared", handleModelsCleared);
    return () => window.removeEventListener("openwhispr-models-cleared", handleModelsCleared);
  }, []);

  const hydrateActiveDownload = useCallback(
    async (preferredModelId?: string, shouldApply: () => boolean = () => true) => {
      const stateVersion = downloadStateVersionRef.current;

      let activeModel:
        | {
            id: string;
            downloadProgress?: number;
            downloadedBytes?: number;
            totalBytes?: number;
            isInstalling?: boolean;
          }
        | undefined;
      try {
        const models: LocalLLMModelStatus[] | undefined =
          await window.electronAPI?.modelGetAll?.();
        const active =
          models?.find((model) => model.isDownloading && model.id === preferredModelId) ??
          models?.find((model) => model.isDownloading);
        if (active) {
          activeModel = {
            id: active.id,
            downloadProgress: active.downloadProgress,
            downloadedBytes: active.downloadedSize,
            totalBytes: active.totalSize,
          };
        }
      } catch {
        return false;
      }

      if (!shouldApply()) return false;

      // A progress/terminal event or a new request supersedes this snapshot.
      if (downloadStateVersionRef.current !== stateVersion) {
        return downloadingModelRef.current !== null;
      }

      if (!activeModel) return false;

      downloadStateVersionRef.current += 1;
      downloadingModelRef.current = activeModel.id;
      setDownloadingModel(activeModel.id);
      setIsInstalling(activeModel.isInstalling ?? false);
      setDownloadError(null);
      setDownloadProgress({
        percentage: activeModel.downloadProgress || 0,
        downloadedBytes: activeModel.downloadedBytes || 0,
        totalBytes: activeModel.totalBytes || 0,
      });
      return true;
    },
    []
  );

  const applyTerminalEvent = useCallback(
    (data: ModelDownloadTerminalEvent) => {
      const trackedModel = downloadingModelRef.current;
      if (trackedModel && trackedModel !== data.modelId) return;

      const terminalVersion = ++downloadStateVersionRef.current;

      if (data.type === "complete") {
        void (async () => {
          try {
            await onDownloadCompleteRef.current?.();
          } catch {
            // The model is already on disk; a refresh failure is non-fatal.
          } finally {
            if (downloadStateVersionRef.current !== terminalVersion) return;
            downloadingModelRef.current = null;
            setIsInstalling(false);
            setDownloadingModel(null);
            setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
          }
        })();
        return;
      }

      const msg = getDownloadErrorMessage(
        t,
        data.error || t("hooks.modelDownload.errors.unknown"),
        data.code
      );
      setDownloadError(msg);
      showAlertDialogRef.current({
        title:
          data.code === "EXTRACTION_FAILED"
            ? t("hooks.modelDownload.installationFailed.title")
            : t("hooks.modelDownload.downloadFailed.title"),
        description: msg,
      });
      downloadingModelRef.current = null;
      setIsInstalling(false);
      setDownloadingModel(null);
      setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
    },
    [t]
  );

  const handleLLMProgress = useCallback(
    (_event: unknown, data: LocalLLMDownloadProgressEvent) => {
      if (isCancellingRef.current) return;

      if (data.type === "complete") {
        const activeRequest = activeDownloadRequestRef.current;
        if (activeRequest?.modelId === data.modelId) {
          downloadStateVersionRef.current += 1;
          activeRequest.terminalEvent = data;
          return;
        }
        applyTerminalEvent({ ...data, modelId: data.modelId });
        return;
      }

      if (data.type === "error") {
        const activeRequest = activeDownloadRequestRef.current;
        if (activeRequest?.modelId === data.modelId) {
          downloadStateVersionRef.current += 1;
          activeRequest.terminalEvent = data;
          return;
        }
        applyTerminalEvent({ ...data, modelId: data.modelId });
        return;
      }

      const trackedModel = downloadingModelRef.current;
      if (trackedModel && trackedModel !== data.modelId) return;

      downloadStateVersionRef.current += 1;

      const now = Date.now();
      const isComplete = (data.progress || 0) >= 100;
      if (!isComplete && now - lastProgressUpdateRef.current < PROGRESS_THROTTLE_MS) {
        return;
      }
      lastProgressUpdateRef.current = now;

      downloadingModelRef.current = data.modelId;
      setDownloadingModel(data.modelId);
      setDownloadProgress({
        percentage: data.progress || 0,
        downloadedBytes: data.downloadedSize || 0,
        totalBytes: data.totalSize || 0,
      });
    },
    [applyTerminalEvent]
  );

  useEffect(() => {
    const dispose = window.electronAPI?.onModelDownloadProgress(handleLLMProgress);

    return () => {
      dispose?.();
    };
  }, [handleLLMProgress]);

  useEffect(() => {
    let cancelled = false;

    const hydrateAfterMount = async () => {
      // A remount can overlap a download starting or its final atomic file move.
      // Retry briefly so a single transitional snapshot cannot restore the idle UI.
      for (const delay of [0, 200, 600]) {
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        if (cancelled) return;

        const hydrated = await hydrateActiveDownload(undefined, () => !cancelled);
        if (cancelled || hydrated || downloadingModelRef.current) return;
      }
    };

    void hydrateAfterMount();
    return () => {
      cancelled = true;
    };
  }, [hydrateActiveDownload]);

  const downloadModel = useCallback(
    async (modelId: string, onSelectAfterDownload?: (id: string) => void) => {
      if (downloadingModelRef.current) {
        toast({
          title: t("hooks.modelDownload.downloadInProgress.title"),
          description: t("hooks.modelDownload.downloadInProgress.description"),
        });
        return;
      }

      let keepActiveDownloadState = false;
      let terminalEventApplied = false;
      const downloadRequest: PendingModelDownloadRequest = { modelId };

      try {
        downloadStateVersionRef.current += 1;
        downloadingModelRef.current = modelId;
        setDownloadingModel(modelId);
        setIsInstalling(false);
        setDownloadError(null);
        setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
        lastProgressUpdateRef.current = 0; // Reset throttle timer
        activeDownloadRequestRef.current = downloadRequest;

        const result = (await window.electronAPI?.modelDownload?.(modelId)) as unknown as
          { success: boolean; error?: string; code?: string } | undefined;

        if (!result?.success) {
          const wasCancelled =
            result?.code === "DOWNLOAD_CANCELLED" ||
            result?.error?.includes("interrupted by user") ||
            result?.error?.includes("cancelled by user");
          if (wasCancelled) return;

          if (result?.code === "DOWNLOAD_IN_PROGRESS") {
            const hydrated = await hydrateActiveDownload(modelId);
            const terminalEvent = downloadRequest.terminalEvent;

            if (terminalEvent) {
              activeDownloadRequestRef.current = null;
              terminalEventApplied = true;
              applyTerminalEvent(terminalEvent);
            } else if (hydrated) {
              keepActiveDownloadState = true;
            } else {
              try {
                await onDownloadCompleteRef.current?.();
              } catch {
                // The active download ended while the duplicate request was resolving.
              }
            }
            toast({
              title: t("hooks.modelDownload.downloadInProgress.title"),
              description: t("hooks.modelDownload.downloadInProgress.description"),
            });
            return;
          }

          if (result?.error) {
            const msg = getDownloadErrorMessage(t, result.error, result.code);
            setDownloadError(msg);
            showAlertDialog({
              title:
                result.code === "EXTRACTION_FAILED"
                  ? t("hooks.modelDownload.installationFailed.title")
                  : t("hooks.modelDownload.downloadFailed.title"),
              description: msg,
            });
          }
        } else {
          onSelectAfterDownload?.(modelId);
        }

        // Await the refresh so the model list is updated before we clear
        // the downloading state in `finally`. This prevents a flash where
        // the model briefly appears "not downloaded".
        try {
          await onDownloadCompleteRef.current?.();
        } catch {
          // Non-fatal — the model is on disk regardless
        }
      } catch (error: unknown) {
        if (isCancellingRef.current) return;

        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          !errorMessage.includes("interrupted by user") &&
          !errorMessage.includes("cancelled by user") &&
          !errorMessage.includes("DOWNLOAD_CANCELLED")
        ) {
          const msg = getDownloadErrorMessage(t, errorMessage);
          setDownloadError(msg);
          showAlertDialog({
            title: t("hooks.modelDownload.downloadFailed.title"),
            description: msg,
          });
        }
      } finally {
        if (activeDownloadRequestRef.current === downloadRequest) {
          activeDownloadRequestRef.current = null;
        }
        if (keepActiveDownloadState) return;
        if (terminalEventApplied) return;
        downloadingModelRef.current = null;
        setIsInstalling(false);
        setDownloadingModel(null);
        setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
      }
    },
    [applyTerminalEvent, hydrateActiveDownload, showAlertDialog, toast, t]
  );

  const deleteModel = useCallback(
    async (modelId: string, onComplete?: () => void) => {
      try {
        await window.electronAPI?.modelDelete?.(modelId);
        toast({
          title: t("hooks.modelDownload.modelDeleted.title"),
          description: t("hooks.modelDownload.modelDeleted.description"),
        });
        onComplete?.();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        showAlertDialog({
          title: t("hooks.modelDownload.deleteFailed.title"),
          description: t("hooks.modelDownload.deleteFailed.description", { error: errorMessage }),
        });
      }
    },
    [toast, showAlertDialog, t]
  );

  const cancelDownload = useCallback(async () => {
    if (!downloadingModel || isCancelling || isInstalling) return;

    setIsCancelling(true);
    isCancellingRef.current = true;
    let cancelled = false;
    try {
      const result = await window.electronAPI?.modelCancelDownload?.(downloadingModel);
      if (!result?.success) return;

      cancelled = true;
      toast({
        title: t("hooks.modelDownload.downloadCancelled.title"),
        description: t("hooks.modelDownload.downloadCancelled.description"),
      });
    } catch (error) {
      console.error("Failed to cancel download:", error);
    } finally {
      setIsCancelling(false);
      isCancellingRef.current = false;
      if (!cancelled) return;

      downloadStateVersionRef.current += 1;
      downloadingModelRef.current = null;
      setIsInstalling(false);
      setDownloadingModel(null);
      setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
      onDownloadCompleteRef.current?.();
    }
  }, [downloadingModel, isCancelling, isInstalling, toast, t]);

  const isDownloading = downloadingModel !== null;
  const isDownloadingModel = useCallback(
    (modelId: string) => downloadingModel === modelId,
    [downloadingModel]
  );

  return {
    downloadingModel,
    downloadProgress,
    downloadError,
    isDownloading,
    isDownloadingModel,
    isInstalling,
    isCancelling,
    downloadModel,
    deleteModel,
    cancelDownload,
    formatETA,
  };
}
