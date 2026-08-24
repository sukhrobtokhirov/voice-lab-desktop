import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import voiceLabMark from "../assets/logo.svg";

interface PushNotificationCardProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * Shared visual chrome for compact desktop push windows. This keeps update and
 * meeting prompts visually aligned as one VoiceLab notification system.
 */
export function PushNotificationCard({
  title,
  description,
  actions,
  onDismiss,
  className = "",
  onMouseEnter,
  onMouseLeave,
}: PushNotificationCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className={[
        "relative flex h-full min-h-0 items-start gap-2 rounded-xl bg-transparent px-1 py-1 pb-2 pt-1.5 backdrop-blur-2xl",
        className,
      ].join(" ")}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label={t("common.dismiss")}
          className="absolute right-0.5 top-0 flex size-4 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      )}

      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white p-1.5">
        <img src={voiceLabMark} alt="" className="h-full w-full" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col self-stretch">
        <p className="pr-5 text-sm font-semibold leading-4 text-foreground">{title}</p>
        {description && (
          <p className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">{description}</p>
        )}
        {actions && <div className="mt-auto flex items-center justify-end gap-1 pt-1">{actions}</div>}
      </div>
    </div>
  );
}
