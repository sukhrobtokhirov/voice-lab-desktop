import { MousePointerClick, MicVocal } from "lucide-react";
import { useTranslation } from "react-i18next";

type ActivationMode = "tap" | "push";

interface ActivationModeSelectorProps {
  value: ActivationMode;
  onChange: (mode: ActivationMode) => void;
  disabled?: boolean;
}

const OPTIONS = [
  { mode: "tap", Icon: MousePointerClick, labelKey: "common.tap" },
  { mode: "push", Icon: MicVocal, labelKey: "common.hold" },
] as const;

export function ActivationModeSelector({
  value,
  onChange,
  disabled = false,
}: ActivationModeSelectorProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`
        relative flex rounded-md p-0.5 transition-colors duration-150
        bg-muted/60 dark:bg-white/[0.06]
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
      `}
    >
      {/* Sliding indicator */}
      <div
        className={`
          absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded
          bg-background dark:bg-white/[0.12]
          transition-transform duration-150 ease-out
          ${value === "push" ? "translate-x-[calc(100%+4px)]" : "translate-x-0"}
        `}
      />

      {OPTIONS.map(({ mode, Icon, labelKey }) => (
        <button
          key={mode}
          type="button"
          disabled={disabled}
          onClick={() => onChange(mode)}
          aria-pressed={value === mode}
          className={`
            relative z-10 flex-1 flex items-center justify-center gap-1 rounded px-2.5 py-1
            transition-colors duration-150
            ${disabled ? "cursor-not-allowed" : "cursor-pointer"}
            ${value === mode ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
          `}
        >
          <Icon className="w-3 h-3" />
          <span className="text-xs font-medium">{t(labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
