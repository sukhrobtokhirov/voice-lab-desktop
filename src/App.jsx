import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import "./index.css";
import { Check, X } from "lucide-react";
import { useToast } from "./components/ui/useToast";
import { LoadingDots } from "./components/ui/LoadingDots";
import { useWindowDrag } from "./hooks/useWindowDrag";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useSettingsStore } from "./stores/settingsStore";

// Sound Wave Icon Component (for idle/hover states)
const SoundWaveIcon = ({ size = 16 }) => {
  return (
    <div className="flex items-center justify-center gap-1">
      <div
        className={`bg-white rounded-full`}
        style={{ width: size * 0.25, height: size * 0.6 }}
      ></div>
      <div className={`bg-white rounded-full`} style={{ width: size * 0.25, height: size }}></div>
      <div
        className={`bg-white rounded-full`}
        style={{ width: size * 0.25, height: size * 0.6 }}
      ></div>
    </div>
  );
};

// Voice Wave Animation Component (for processing state)
const VoiceWaveIndicator = ({ isListening }) => {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className={`w-0.5 bg-white rounded-full transition-[height] duration-150 ${
            isListening ? "animate-pulse h-4" : "h-2"
          }`}
          style={{
            animationDelay: isListening ? `${i * 0.1}s` : "0s",
            animationDuration: isListening ? `${0.6 + i * 0.1}s` : "0s",
          }}
        />
      ))}
    </div>
  );
};

const formatRecordingDuration = (seconds) => {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

// Keep the island visible while developing so its dimensions and position can
// be tuned without starting a dictation. Vite replaces this with `false` in
// release builds, so the preview can never ship to customers.
const RECORDING_ISLAND_DEV_PREVIEW = import.meta.env.DEV;

const RecordingIsland = ({ elapsedSeconds, audioLevel }) => {
  const level = Math.min(1, Math.max(0, Number(audioLevel) || 0));
  const barShape = [0.38, 0.6, 0.82, 1, 0.72, 0.46, 0.68, 0.94, 0.78, 0.52, 0.34];

  return (
    <div className="recording-island pointer-events-none flex h-full w-full items-center justify-center">
      <div className="flex h-12 min-w-[14rem] items-center gap-3 rounded-br-[28px] rounded-bl-[28px] mt-[-20px] border border-white/10 bg-[#080808]/95 px-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.36)] backdrop-blur-2xl">
        <span className="flex items-center gap-1.5 font-mono text-xs font-medium tabular-nums tracking-tight text-white/90">
          <span className="size-1.5 rounded-full bg-[#ff453a]" />
          {formatRecordingDuration(elapsedSeconds)}
        </span>
        <span className="h-4 w-px bg-white/12" aria-hidden="true" />
        <div
          className="flex h-6 flex-1 items-center justify-center gap-[3px]"
          aria-label="Microphone input level"
          role="img"
        >
          {barShape.map((shape, index) => {
            const height = 4 + Math.round(level * (7 + shape * 16));
            const opacity = 0.38 + level * 0.62;
            return (
              <span
                key={index}
                className="w-[2px] rounded-full bg-white transition-[height,opacity] duration-75 ease-out"
                style={{ height: `${height}px`, opacity }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

// Tooltip Component
const Tooltip = ({ children, content, emoji, align = "center" }) => {
  const [isVisible, setIsVisible] = useState(false);

  const alignClass =
    align === "right" ? "right-0" : align === "left" ? "left-0" : "left-1/2 -translate-x-1/2";

  const arrowClass =
    align === "right" ? "right-3" : align === "left" ? "left-3" : "left-1/2 -translate-x-1/2";

  return (
    <div className="relative inline-block">
      <div onMouseEnter={() => setIsVisible(true)} onMouseLeave={() => setIsVisible(false)}>
        {children}
      </div>
      {isVisible && (
        <div
          className={`absolute bottom-full ${alignClass} mb-2 px-1.5 py-1 text-2xs text-popover-foreground bg-popover border border-border rounded-md z-10 shadow-lg transition-opacity duration-150 whitespace-nowrap`}
        >
          {emoji && <span className="mr-1">{emoji}</span>}
          {content}
          <div
            className={`absolute top-full ${arrowClass} w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-popover`}
          ></div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [isHovered, setIsHovered] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const commandMenuRef = useRef(null);
  const buttonRef = useRef(null);
  const { toast, dismiss, toastCount } = useToast();
  const { t } = useTranslation();
  const { isDragging, handleMouseDown, handleMouseUp } = useWindowDrag();

  const [dragStartPos, setDragStartPos] = useState(null);
  const [hasDragged, setHasDragged] = useState(false);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [recordingIslandSupported, setRecordingIslandSupported] = useState(false);

  // Floating icon auto-hide setting (read from store, synced via IPC)
  const floatingIconAutoHide = useSettingsStore((s) => s.floatingIconAutoHide);
  const panelStartPosition = useSettingsStore((s) => s.panelStartPosition);
  const prevAutoHideRef = useRef(floatingIconAutoHide);

  const setWindowInteractivity = React.useCallback((shouldCapture) => {
    // Main process captures target PID when enabling interactivity.
    window.electronAPI?.setMainWindowInteractivity?.(shouldCapture);
  }, []);

  useEffect(() => {
    setWindowInteractivity(false);
    return () => setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  useEffect(() => {
    let disposed = false;

    const checkRecordingIslandSupport = async () => {
      try {
        const supported = await window.electronAPI?.getRecordingIslandSupport?.();
        if (!disposed) setRecordingIslandSupported(Boolean(supported));
      } catch {
        // The normal floating control is the safe fallback.
        if (!disposed) setRecordingIslandSupported(false);
      }
    };

    void checkRecordingIslandSupport();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribeFallback = window.electronAPI?.onHotkeyFallbackUsed?.((data) => {
      toast({
        title: t("app.toasts.hotkeyChanged.title"),
        description: t("app.toasts.hotkeyChanged.description", {
          original: data.original,
          fallback: data.fallback,
        }),
        duration: 8000,
      });
    });

    const unsubscribeFailed = window.electronAPI?.onHotkeyRegistrationFailed?.((_data) => {
      toast({
        title: t("app.toasts.hotkeyUnavailable.title"),
        description: t("app.toasts.hotkeyUnavailable.description"),
        duration: 10000,
      });
    });

    const showGpuFallbackToast = () => {
      toast({
        title: t("app.toasts.gpuFallback.title"),
        description: t("app.toasts.gpuFallback.description"),
        duration: 10000,
      });
    };
    const unsubscribeCudaFallback =
      window.electronAPI?.onCudaFallbackNotification?.(showGpuFallbackToast);
    const unsubscribeGpuFallback =
      window.electronAPI?.onGpuFallbackNotification?.(showGpuFallbackToast);

    const unsubscribeCorrections = window.electronAPI?.onCorrectionsLearned?.((words) => {
      if (words && words.length > 0) {
        const wordList = words.map((w) => `\u201c${w}\u201d`).join(", ");
        let toastId;
        toastId = toast({
          title: t("app.toasts.addedToDict", { words: wordList }),
          variant: "success",
          duration: 6000,
          action: (
            <button
              onClick={async () => {
                try {
                  const result = await window.electronAPI?.undoLearnedCorrections?.(words);
                  if (result?.success) {
                    dismiss(toastId);
                  }
                } catch {
                  // silently fail — word stays in dictionary
                }
              }}
              className="text-2xs font-medium px-2.5 py-1 rounded-sm whitespace-nowrap
                text-emerald-100/90 hover:text-white
                bg-emerald-500/15 hover:bg-emerald-500/25
                border border-emerald-400/20 hover:border-emerald-400/35
                transition-all duration-150"
            >
              {t("app.toasts.undo")}
            </button>
          ),
        });
      }
    });

    return () => {
      unsubscribeFallback?.();
      unsubscribeFailed?.();
      unsubscribeCudaFallback?.();
      unsubscribeGpuFallback?.();
      unsubscribeCorrections?.();
    };
  }, [toast, dismiss, t]);

  useEffect(() => {
    if (isCommandMenuOpen || toastCount > 0) {
      setWindowInteractivity(true);
    } else if (!isHovered) {
      setWindowInteractivity(false);
    }
  }, [isCommandMenuOpen, isHovered, toastCount, setWindowInteractivity]);

  const handleDictationToggle = React.useCallback(() => {
    setIsCommandMenuOpen(false);
    setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  const {
    isRecording,
    isProcessing,
    micCaptureStatus,
    wasPlaced,
    audioLevel,
    toggleListening,
    cancelRecording,
    cancelProcessing,
  } = useAudioRecording(toast, {
    onToggle: handleDictationToggle,
  });

  const showRecordingIsland =
    recordingIslandSupported && (isRecording || RECORDING_ISLAND_DEV_PREVIEW);

  useEffect(() => {
    if (!showRecordingIsland) {
      setRecordingElapsedSeconds(0);
      return undefined;
    }

    const startedAt = Date.now();
    setIsHovered(false);
    setRecordingElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setRecordingElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);

    return () => window.clearInterval(timer);
  }, [isRecording, showRecordingIsland]);

  useEffect(() => {
    if (showRecordingIsland) {
      window.electronAPI?.resizeMainWindow?.("RECORDING_ISLAND");
    } else if (isCommandMenuOpen && toastCount > 0) {
      window.electronAPI?.resizeMainWindow?.("EXPANDED");
    } else if (isCommandMenuOpen) {
      window.electronAPI?.resizeMainWindow?.("WITH_MENU");
    } else if (toastCount > 0) {
      window.electronAPI?.resizeMainWindow?.("WITH_TOAST");
    } else {
      window.electronAPI?.resizeMainWindow?.("BASE");
    }
  }, [isCommandMenuOpen, showRecordingIsland, toastCount]);

  const captureTargetThenToggle = React.useCallback(async () => {
    try {
      await window.electronAPI?.captureTargetPid?.();
    } catch {
      /* non-fatal — paste path will try again */
    }
    toggleListening();
  }, [toggleListening]);

  // Sync auto-hide from main process — setState directly to avoid IPC echo
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onFloatingIconAutoHideChanged?.((enabled) => {
      localStorage.setItem("floatingIconAutoHide", String(enabled));
      useSettingsStore.setState({ floatingIconAutoHide: enabled });
    });
    return () => unsubscribe?.();
  }, []);

  const isRecordingRef = useRef(isRecording);

  useLayoutEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onCancelHotkeyPressed?.(() => {
      if (isRecordingRef.current) cancelRecording();
    });
    return () => unsubscribe?.();
  }, [cancelRecording]);

  // Auto-hide the floating icon when idle (setting enabled or dictation cycle completed)
  useEffect(() => {
    let hideTimeout;

    if (floatingIconAutoHide && !isRecording && !isProcessing && toastCount === 0) {
      // Delay briefly so processing can start after recording stops without a flash
      hideTimeout = setTimeout(() => {
        window.electronAPI?.hideWindow?.();
      }, 500);
    } else if (!floatingIconAutoHide && prevAutoHideRef.current) {
      window.electronAPI?.showDictationPanel?.();
    }

    prevAutoHideRef.current = floatingIconAutoHide;
    return () => clearTimeout(hideTimeout);
  }, [isRecording, isProcessing, floatingIconAutoHide, toastCount]);

  const handleClose = () => {
    window.electronAPI.hideWindow();
  };

  useEffect(() => {
    if (!isCommandMenuOpen) {
      return;
    }

    const handleClickOutside = (event) => {
      if (
        commandMenuRef.current &&
        !commandMenuRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsCommandMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCommandMenuOpen]);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === "Escape") {
        if (isCommandMenuOpen) {
          setIsCommandMenuOpen(false);
        } else {
          handleClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, [isCommandMenuOpen]);

  // Determine current mic state
  const getMicState = () => {
    if (isRecording && (micCaptureStatus === "reconnecting" || micCaptureStatus === "unavailable"))
      return "unavailable";
    if (isRecording) return "recording";
    if (isProcessing) return "processing";
    if (wasPlaced) return "placed";
    if (isHovered && !isRecording && !isProcessing) return "hover";
    return "idle";
  };

  const micState = getMicState();

  const getMicButtonProps = () => {
    const baseClasses =
      "rounded-full w-[52px] h-[52px] flex items-center justify-center relative overflow-hidden border-2 border-white/70 cursor-pointer";

    switch (micState) {
      case "idle":
      case "hover":
        return {
          className: `${baseClasses} bg-black/50 cursor-pointer`,
          tooltip: t("app.mic.clickToSpeak"),
        };
      case "recording":
        return {
          className: `${baseClasses} bg-primary cursor-pointer`,
          tooltip: t("app.mic.recording"),
        };
      case "unavailable":
        return {
          className: `${baseClasses} bg-amber-500 cursor-pointer`,
          tooltip: t("app.mic.waitingForMicrophone"),
        };
      case "processing":
        return {
          className: `${baseClasses} bg-accent cursor-not-allowed`,
          tooltip: t("app.mic.processing"),
        };
      case "placed":
        return {
          className: `${baseClasses} bg-primary cursor-pointer`,
          tooltip: t("desktop.dictation.ready", { defaultValue: "Ready" }),
        };
      default:
        return {
          className: `${baseClasses} bg-black/50 cursor-pointer`,
          style: { transform: "scale(0.8)" },
          tooltip: t("app.mic.clickToSpeak"),
        };
    }
  };

  const micProps = getMicButtonProps();

  return (
    <div className="dictation-window">
      {showRecordingIsland ? (
        <RecordingIsland
          elapsedSeconds={recordingElapsedSeconds}
          audioLevel={isRecording ? audioLevel : 0.12}
        />
      ) : (
        <>
          {/* Voice button - position determined by panelStartPosition setting */}
          <div
        className={`fixed bottom-1 z-50 ${
          panelStartPosition === "bottom-left"
            ? "left-1"
            : panelStartPosition === "center"
              ? "left-1/2 -translate-x-1/2"
              : "right-1"
        }`}
      >
        <div
          className="relative flex items-center gap-2"
          onMouseEnter={() => {
            setIsHovered(true);
            setWindowInteractivity(true);
          }}
          onMouseLeave={() => {
            setIsHovered(false);
            if (!isCommandMenuOpen) {
              setWindowInteractivity(false);
            }
          }}
        >
          {(isRecording || isProcessing) && isHovered && (
            <button
              aria-label={
                isRecording ? t("app.buttons.cancelRecording") : t("app.buttons.cancelProcessing")
              }
              onClick={(e) => {
                e.stopPropagation();
                isRecording ? cancelRecording() : cancelProcessing();
              }}
              className="group/cancel w-5 h-5 rounded-full bg-surface-2/90 hover:bg-destructive border border-border hover:border-destructive/70 flex items-center justify-center transition-colors duration-150 shadow-sm backdrop-blur-sm"
            >
              <X
                size={10}
                strokeWidth={2.5}
                className="text-foreground group-hover/cancel:text-destructive-foreground transition-colors duration-150"
              />
            </button>
          )}
          <Tooltip
            content={micProps.tooltip}
            align={
              panelStartPosition === "bottom-left"
                ? "left"
                : panelStartPosition === "center"
                  ? "center"
                  : "right"
            }
          >
            <button
              ref={buttonRef}
              aria-label={micProps.tooltip}
              aria-pressed={micState === "recording"}
              aria-busy={micState === "processing"}
              disabled={micState === "processing" || micState === "unavailable"}
              onMouseDown={(e) => {
                setIsCommandMenuOpen(false);
                setDragStartPos({ x: e.clientX, y: e.clientY });
                setHasDragged(false);
                handleMouseDown(e);
              }}
              onMouseMove={(e) => {
                if (dragStartPos && !hasDragged) {
                  const distance = Math.sqrt(
                    Math.pow(e.clientX - dragStartPos.x, 2) +
                      Math.pow(e.clientY - dragStartPos.y, 2)
                  );
                  if (distance > 5) {
                    // 5px threshold for drag
                    setHasDragged(true);
                  }
                }
              }}
              onMouseUp={(e) => {
                handleMouseUp(e);
                setDragStartPos(null);
              }}
              onClick={(e) => {
                if (!hasDragged && micState !== "processing" && micState !== "unavailable") {
                  setIsCommandMenuOpen(false);
                  void captureTargetThenToggle();
                }
                e.preventDefault();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!hasDragged) {
                  setWindowInteractivity(true);
                  setIsCommandMenuOpen((prev) => !prev);
                }
              }}
              onFocus={() => setIsHovered(true)}
              onBlur={() => setIsHovered(false)}
              className={micProps.className}
              style={{
                ...micProps.style,
                cursor:
                  micState === "processing"
                    ? "not-allowed !important"
                    : isDragging
                      ? "grabbing !important"
                      : "pointer !important",
                transition:
                  "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s ease-out",
              }}
            >
              {/* Background effects */}
              <div
                className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent transition-opacity duration-150"
                style={{ opacity: micState === "hover" ? 0.8 : 0 }}
              ></div>
              <div
                className="absolute inset-0 transition-colors duration-150"
                style={{
                  backgroundColor: micState === "hover" ? "rgba(0,0,0,0.1)" : "transparent",
                }}
              ></div>

              {/* Dynamic content based on state */}
              {micState === "idle" || micState === "hover" ? (
                <SoundWaveIcon size={micState === "idle" ? 16 : 18} />
              ) : micState === "recording" ? (
                <LoadingDots />
              ) : micState === "processing" ? (
                <VoiceWaveIndicator isListening={true} />
              ) : micState === "unavailable" ? (
                <span className="text-white text-lg font-bold">!</span>
              ) : micState === "placed" ? (
                <Check className="h-[18px] w-[18px] text-white" />
              ) : null}
              <span className="sr-only">{micProps.tooltip}</span>

              {/* State indicator ring for recording */}
              {micState === "recording" && (
                <div className="absolute inset-0 rounded-full border-2 border-primary/50 animate-pulse"></div>
              )}
              {micState === "unavailable" && (
                <div className="absolute inset-0 rounded-full border-2 border-amber-200/70 animate-pulse"></div>
              )}

              {/* State indicator ring for processing */}
              {micState === "processing" && (
                <div className="absolute inset-0 rounded-full border-2 border-primary/30 opacity-50"></div>
              )}
            </button>
          </Tooltip>
          {isCommandMenuOpen && (
            <div
              ref={commandMenuRef}
              className="absolute bottom-full right-0 mb-3 w-48 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg backdrop-blur-sm"
              onMouseEnter={() => {
                setWindowInteractivity(true);
              }}
              onMouseLeave={() => {
                if (!isHovered) {
                  setWindowInteractivity(false);
                }
              }}
            >
              <button
                className="w-full px-3 py-2 text-left text-sm font-medium hover:bg-muted focus:bg-muted focus:outline-none"
                onClick={() => {
                  void captureTargetThenToggle();
                }}
              >
                {isRecording
                  ? t("app.commandMenu.stopListening")
                  : t("app.commandMenu.startListening")}
              </button>
              <div className="h-px bg-border" />
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                onClick={() => {
                  setIsCommandMenuOpen(false);
                  setWindowInteractivity(false);
                  handleClose();
                }}
              >
                {t("app.commandMenu.hideForNow")}
              </button>
            </div>
          )}
        </div>
          </div>
        </>
      )}
    </div>
  );
}
