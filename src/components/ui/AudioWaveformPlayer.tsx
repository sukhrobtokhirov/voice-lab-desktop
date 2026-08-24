import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import playIcon from "../../assets/icons/play.svg";
import pauseIcon from "../../assets/icons/pause.svg";
import { cn } from "../lib/utils";

const WAVEFORM_BARS = [
  38, 66, 44, 82, 58, 31, 72, 49, 88, 55, 36, 67, 43, 76, 52, 91, 46, 63, 34, 79, 57, 41,
  70, 50, 84, 39, 61, 47, 74, 54, 32, 68,
];

interface AudioWaveformPlayerProps {
  src: string;
  fallbackDurationSeconds?: number | null;
  onSourceError: () => void;
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const wholeSeconds = Math.floor(value);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function PlayerIcon({ isPlaying }: { isPlaying: boolean }) {
  const source = isPlaying ? pauseIcon : playIcon;

  return (
    <span
      aria-hidden="true"
      className="block size-3.5 bg-current"
      style={{
        maskImage: `url("${source}")`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url("${source}")`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  );
}

export default function AudioWaveformPlayer({
  src,
  fallbackDurationSeconds = null,
  onSourceError,
}: AudioWaveformPlayerProps) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourceErrorReportedRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDurationSeconds ?? 0);

  useEffect(() => {
    sourceErrorReportedRef.current = false;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(fallbackDurationSeconds ?? 0);
  }, [fallbackDurationSeconds, src]);

  const reportSourceError = () => {
    if (sourceErrorReportedRef.current) return;
    sourceErrorReportedRef.current = true;
    setIsPlaying(false);
    onSourceError();
  };

  const updateDuration = () => {
    const nextDuration = audioRef.current?.duration;
    if (typeof nextDuration === "number" && Number.isFinite(nextDuration) && nextDuration > 0) {
      setDuration(nextDuration);
    }
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        reportSourceError();
      }
      return;
    }

    audio.pause();
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(duration) || duration <= 0) return;
    const nextTime = Math.max(0, Math.min(value, duration));
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  return (
    <div className="flex h-12 items-center gap-3 rounded-xl border border-border/70 bg-foreground/[0.025] px-2.5 dark:border-white/10 dark:bg-white/[0.035]">
      <audio
        key={src}
        ref={audioRef}
        className="hidden"
        preload="metadata"
        src={src}
        onCanPlay={updateDuration}
        onDurationChange={updateDuration}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
        onError={reportSourceError}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
      />

      <button
        type="button"
        onClick={() => void togglePlayback()}
        aria-label={t(
          isPlaying
            ? "controlPanel.history.savedDictation.pauseAudio"
            : "controlPanel.history.savedDictation.playAudio"
        )}
        aria-pressed={isPlaying}
        className="grid size-7 shrink-0 place-items-center rounded-md text-foreground transition-colors duration-150 hover:bg-foreground/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-white/85 dark:hover:bg-white/[0.1]"
      >
        <PlayerIcon isPlaying={isPlaying} />
      </button>

      <div className="relative flex h-7 min-w-0 flex-1 items-center rounded-md has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-sky-500/70">
        <div aria-hidden="true" className="flex h-full w-full items-center justify-between gap-0.5">
          {WAVEFORM_BARS.map((height, index) => {
            const played = (index + 1) / WAVEFORM_BARS.length <= progress;
            return (
              <span
                key={`${height}-${index}`}
                className={cn(
                  "w-px rounded-full transition-colors duration-150",
                  played ? "bg-foreground/85 dark:bg-white/85" : "bg-muted-foreground/35"
                )}
                style={{ height: `${height}%` }}
              />
            );
          })}
        </div>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label={t("controlPanel.history.savedDictation.audioProgress")}
          aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 focus-visible:outline-none disabled:cursor-default"
          disabled={duration <= 0}
        />
      </div>

      <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );
}
