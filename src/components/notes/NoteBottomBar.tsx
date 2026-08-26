import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "../lib/utils";
import { formatMmSs } from "../../utils/formatDuration";

const BAR_COUNT = 5;

interface NoteBottomBarProps {
  isRecording: boolean;
  isProcessing: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

export default function NoteBottomBar({
  isRecording,
  isProcessing,
  onStartRecording,
  onStopRecording,
}: NoteBottomBarProps) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isRecording) {
      setElapsed(0);
      return;
    }
    const id = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(id);
  }, [isRecording]);

  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 bg-background px-5 pb-4 pt-3">
      <div className="pointer-events-auto flex justify-center">
        {isRecording ? (
          <button
            onClick={onStopRecording}
            className={cn(
              "flex h-10 items-center gap-2 rounded-xl border border-primary/20 bg-primary/6 pl-3.5 pr-3 transition-colors duration-150",
              "hover:bg-primary/10 dark:border-primary/25 dark:bg-primary/10 dark:hover:bg-primary/15"
            )}
          >
            <div className="flex h-3.5 items-end gap-0.5">
              {Array.from({ length: BAR_COUNT }, (_, index) => (
                <div
                  key={index}
                  className="w-0.5 origin-bottom rounded-full bg-primary/60 dark:bg-primary/70"
                  style={{
                    height: "100%",
                    animation: `waveform-bar ${0.5 + index * 0.07}s ease-in-out infinite`,
                    animationDelay: `${index * 0.04}s`,
                  }}
                />
              ))}
            </div>
            <span className="text-2xs tabular-nums font-medium text-primary/60 dark:text-primary/70">
              {formatMmSs(elapsed)}
            </span>
            <Square size={9} fill="currentColor" className="text-primary/50" />
          </button>
        ) : isProcessing ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/20 bg-foreground/3 dark:border-white/6 dark:bg-white/4">
            <Loader2 size={14} className="animate-spin text-foreground/25" />
          </div>
        ) : (
          <button
            onClick={onStartRecording}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl border border-border/20 bg-foreground/3 text-foreground/30 transition-all duration-200",
              "hover:border-border/30 hover:bg-foreground/6 hover:text-foreground/50 active:scale-95",
              "dark:border-white/6 dark:bg-white/4 dark:text-foreground/20 dark:hover:border-white/10 dark:hover:bg-white/8 dark:hover:text-foreground/35"
            )}
            aria-label={t("notes.editor.transcribe")}
          >
            <Mic size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
