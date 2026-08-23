import React from "react";
import {
  BookOpen,
  Download,
  History,
  MessageSquare,
  NotebookPen,
  Search,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
import UsageDisplay from "./UsageDisplay";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useUsage } from "../hooks/useUsage";
import { getCachedPlatform } from "../utils/platform";
import { VOICELAB_AI_ENABLED } from "../lib/features";

const platform = getCachedPlatform();

export const CONTROL_PANEL_SIDEBAR_WIDTH_PX = 256;

export type ControlPanelView =
  "home" | "chat" | "personal-notes" | "dictionary" | "upload" | "integrations";

interface ControlPanelSidebarProps {
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  userName?: string | null;
  userImage?: string | null;
  isSignedIn?: boolean;
  authLoaded?: boolean;
  updateAction?: {
    label: string;
    progress: number;
    disabled?: boolean;
    onClick: () => void;
  };
}

const navButton =
  "group flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-base font-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/20";

function initialsFromName(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] || "V")[0] || "V";
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] || "" : "";
  return `${first}${last}`.toLocaleUpperCase();
}

function ProfileAvatar({
  name,
  image,
  className,
}: {
  name: string;
  image?: string | null;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const [imageReady, setImageReady] = React.useState(false);

  React.useEffect(() => {
    setImageFailed(false);
    setImageReady(false);
  }, [image]);

  if (image && !imageFailed) {
    return (
      <span className={cn("relative flex size-full shrink-0 overflow-hidden rounded-full", className)}>
        {!imageReady && (
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-pulse rounded-full bg-foreground/10"
          />
        )}
        <img
          src={image}
          alt=""
          className={cn(
            "absolute inset-0 size-full rounded-full object-cover"
          )}
          onLoad={() => setImageReady(true)}
          onError={() => setImageFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-full shrink-0 items-center justify-center rounded-full bg-background text-xs font-medium leading-none text-foreground/65",
        className
      )}
    >
      {initialsFromName(name)}
    </span>
  );
}

function usedUsagePercentage(
  usage: ReturnType<typeof useUsage>
): number | null {
  const limit = usage?.sttUsage?.limit_seconds;
  const remaining = usage?.sttUsage?.remaining_seconds;
  if (!limit || remaining === undefined) return null;
  const used = limit - remaining;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

function UsageProgressRing({ percentage }: { percentage: number }) {
  const roundedPercentage = Math.round(percentage);
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full -rotate-[70deg]"
      viewBox="0 0 40 40"
      aria-hidden="true"
    >
      <circle
        cx="20"
        cy="20"
        r="17"
        fill="none"
        pathLength="100"
        stroke="currentColor"
        strokeWidth="2"
        className="text-black/12 dark:text-[#403a32]"
      />
      <circle
        cx="20"
        cy="20"
        r="17"
        fill="none"
        pathLength="100"
        stroke="currentColor"
        strokeDasharray="100"
        strokeDashoffset={100 - roundedPercentage}
        strokeLinecap="round"
        strokeWidth="2"
        className="text-black/80 transition-[stroke-dashoffset] duration-200 ease-out dark:text-white/95"
      />
    </svg>
  );
}

function UsagePercentage({ percentage }: { percentage: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-full items-center justify-center text-xs font-semibold leading-none tabular-nums text-foreground/75"
    >
      {Math.round(percentage)}%
    </span>
  );
}

function UpdateActionButton({
  label,
  progress,
  disabled = false,
  onClick,
}: NonNullable<ControlPanelSidebarProps["updateAction"]>) {
  const roundedProgress = Math.round(Math.min(100, Math.max(0, progress)));

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label}: ${roundedProgress}%`}
      title={label}
      className="group/update relative flex size-8 shrink-0 items-center justify-center rounded-md text-foreground/65 outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:cursor-default disabled:opacity-50 dark:text-emerald/70"
    >
      <svg className="absolute inset-0 size-8 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          pathLength="100"
          stroke="currentColor"
          strokeWidth="2"
          className="text-foreground/15"
        />
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          pathLength="100"
          stroke="currentColor"
          strokeDasharray="100"
          strokeDashoffset={100 - roundedProgress}
          strokeLinecap="round"
          strokeWidth="2"
          className="text-neutral-500 transition-[stroke-dashoffset] duration-200 ease-out"
        />
      </svg>
      <Download className="size-4 transition-[opacity,transform] duration-200 ease-out group-hover/update:scale-[0.9] group-hover/update:opacity-0 group-focus-visible/update:scale-[0.9] group-focus-visible/update:opacity-0" />
      <span className="absolute text-2xs font-semibold leading-none tabular-nums opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover/update:scale-100 group-hover/update:opacity-100 group-focus-visible/update:scale-100 group-focus-visible/update:opacity-100">
        {roundedProgress}%
      </span>
    </button>
  );
}

function ProfileUsageControl({
  name,
  image,
  percentage,
  label,
}: {
  name: string;
  image?: string | null;
  percentage: number | null;
  label: string;
}) {
  const [open, setOpen] = React.useState(false);
  const showUsageOnHover = percentage !== null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="group flex min-w-0 flex-1 animate-in fade-in-0 items-center gap-2.5 rounded-md px-2.5 py-0.5 text-left outline-none transition-colors duration-200 hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-foreground/20 dark:hover:bg-white/[0.06]"
        >
          <span className={cn("relative shrink-0", showUsageOnHover ? "size-10" : "size-8")}>
            {showUsageOnHover && (
              <UsageProgressRing percentage={percentage} />
            )}
            <span
              className={cn(
                "absolute z-10 overflow-hidden rounded-full border border-black/8 bg-[#f8f8f8] transition-opacity duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] dark:border-white/12 dark:bg-white/12",
                showUsageOnHover ? "inset-1.5" : "inset-0",
                showUsageOnHover && "group-hover:opacity-0 group-focus-visible:opacity-0"
              )}
            >
              <ProfileAvatar name={name} image={image} />
            </span>
            {showUsageOnHover && (
              <span className="absolute inset-0 z-20 opacity-0 transition-opacity duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:opacity-100 group-focus-visible:opacity-100">
                <UsagePercentage percentage={percentage} />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-5">{name}</span>
          </span>
        </button>
      </PopoverTrigger>
      {open && (
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          className="w-[min(20rem,calc(100vw-2rem))] p-4"
        >
          <UsageDisplay surface="profile" autoRefresh />
        </PopoverContent>
      )}
    </Popover>
  );
}

function ProfileIdentitySkeleton() {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5" aria-busy="true">
      <span className="relative size-10 shrink-0">
        <span className="absolute inset-0 rounded-full border-2 border-foreground/10" />
        <span className="absolute inset-1.5 animate-pulse rounded-full bg-foreground/10" />
      </span>
      <span className="h-4 w-24 animate-pulse rounded bg-foreground/10" />
    </div>
  );
}

export default function ControlPanelSidebar({
  activeView,
  onViewChange,
  onOpenSettings,
  onOpenSearch,
  userName,
  userImage,
  isSignedIn,
  authLoaded,
  updateAction,
}: ControlPanelSidebarProps) {
  const { t } = useTranslation();
  const usage = useUsage();
  const profileName = userName || t("sidebar.defaultUser", { defaultValue: "VoiceLab user" });
  const usagePercentage = usedUsagePercentage(usage);
  const isProfileLoading = !authLoaded;
  const primaryItems = [
    {
      id: "home" as const,
      label: t("desktop.nav.history", { defaultValue: "History" }),
      icon: History,
    },
    {
      id: "dictionary" as const,
      label: t("desktop.nav.vocabulary", { defaultValue: "Vocabulary" }),
      icon: BookOpen,
    },
    ...(VOICELAB_AI_ENABLED
      ? [
          {
            id: "chat" as const,
            label: "VoiceLab AI",
            icon: MessageSquare,
          },
        ]
      : []),
    {
      id: "personal-notes" as const,
      label: t("sidebar.notes", { defaultValue: "Notes" }),
      icon: NotebookPen,
    },
  ];

  const renderItem = ({
    id,
    label,
    icon: Icon,
  }: (typeof primaryItems)[number]) => {
    const active = activeView === id;
    return (
      <button
        key={id}
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={() => onViewChange(id)}
        className={cn(
          navButton,
          active
            ? "bg-black/[0.055] font-medium text-foreground dark:bg-white/[0.08]"
            : "text-foreground/60 hover:bg-black/[0.035] hover:text-foreground dark:text-foreground/65 dark:hover:bg-white/[0.06]"
        )}
      >
        <Icon
          className={cn(
            "h-[18px] w-[18px] shrink-0 transition-opacity",
            active ? "text-foreground" : "text-foreground/55 group-hover:text-foreground/80"
          )}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    );
  };

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r border-black/10 bg-white text-foreground dark:border-white/12 dark:bg-[#171717]"
      style={{ width: CONTROL_PANEL_SIDEBAR_WIDTH_PX }}
    >
      <div className="h-12 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />

      <div className="px-3 pb-4">
        {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex h-8 w-full items-center gap-2 rounded-[10px] border border-black/10 bg-white px-2.5 text-sm text-foreground/50 outline-none transition-colors hover:bg-black/[0.025] hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-foreground/15 dark:border-white/15 dark:bg-transparent dark:text-foreground/60 dark:hover:bg-white/[0.06] dark:hover:text-foreground/85"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">
              {t("commandSearch.shortPlaceholder", { defaultValue: "Search" })}
            </span>
            <kbd className="rounded-[5px] border border-current/15 px-1.5 py-0.5 text-xs font-medium leading-4 opacity-65">
              {platform === "darwin" ? "⌘K" : "Ctrl K"}
            </kbd>
          </button>
        )}
      </div>

      <nav aria-label="VoiceLab" className="px-3">
        <p className="mb-2 px-2.5 text-xs font-medium text-foreground/40 dark:text-foreground/45">
          {t("desktop.nav.desktop", { defaultValue: "Desktop" })}
        </p>
        <div className="space-y-0.5">{primaryItems.map(renderItem)}</div>
      </nav>

      <div className="flex-1" />

      <div className="border-t border-black/10 p-3 dark:border-white/12">
        <div className="flex min-h-10 items-center gap-1 px-2.5">
          {isProfileLoading ? (
            <ProfileIdentitySkeleton />
          ) : isSignedIn ? (
            <ProfileUsageControl
              name={profileName}
              image={userImage}
              percentage={usagePercentage}
              label={`${profileName}: ${t("desktop.wallet.title")}`}
            />
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5">
              <span className="relative size-8 shrink-0 overflow-hidden rounded-full border border-black/8 bg-[#f8f8f8] dark:border-white/12 dark:bg-white/12">
                <ProfileAvatar name={profileName} image={userImage} />
              </span>
              <p className="truncate text-sm leading-5 text-muted-foreground">
                {t("sidebar.notSignedIn", { defaultValue: "Not signed in" })}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={t("sidebar.settings", { defaultValue: "Settings" })}
            title={t("sidebar.settings", { defaultValue: "Settings" })}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground/55 outline-none transition-colors hover:bg-black/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20 dark:text-foreground/65 dark:hover:bg-white/[0.08]"
          >
            <Settings className="h-[18px] w-[18px]" />
          </button>
          {updateAction && <UpdateActionButton {...updateAction} />}
        </div>
      </div>
    </aside>
  );
}
