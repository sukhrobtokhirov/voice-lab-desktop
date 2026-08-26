import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
import UsageDisplay from "./UsageDisplay";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import VoiceLabIcon from "./ui/VoiceLabIcon";
import { useUsage, type UseUsageResult } from "../hooks/useUsage";
import { getCachedPlatform } from "../utils/platform";
import { VOICELAB_AI_ENABLED } from "../lib/features";
import historyIcon from "../assets/icons/history.svg";
import bookmarkIcon from "../assets/icons/bookmark.svg";
import speechToTextIcon from "../assets/icons/speech-to-text.svg";
import settingsIcon from "../assets/icons/settings.svg";
import downloadIcon from "../assets/icons/download.svg";
import sidebarOpenIcon from "../assets/icons/sidebar-open.svg";
import sidebarClosedIcon from "../assets/icons/sidebar-closed.svg";
import notesIcon from "../assets/icons/notes.svg";
import searchIcon from "../assets/icons/search.svg";

const platform = getCachedPlatform();

export const CONTROL_PANEL_SIDEBAR_WIDTH_PX = 240;
// Leave room for macOS window controls when the navigation is collapsed.
export const CONTROL_PANEL_SIDEBAR_RAIL_WIDTH_PX = 88;

export type ControlPanelView =
  "home" | "chat" | "personal-notes" | "dictionary" | "upload" | "integrations";

interface ControlPanelSidebarProps {
  activeView: ControlPanelView;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  userName?: string | null;
  userImage?: string | null;
  isSignedIn?: boolean;
  authLoaded?: boolean;
  /** Shared app-level usage state keeps this persistent sidebar and its popover in sync. */
  usageState?: UseUsageResult | null;
  updateAction?: {
    label: string;
    progress: number;
    disabled?: boolean;
    onClick: () => void;
  };
}

const navButton =
  "group flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-base font-normal outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-foreground/20";

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
      <VoiceLabIcon
        source={downloadIcon}
        className="size-4 transition-opacity duration-150 group-hover/update:opacity-0 group-focus-visible/update:opacity-0"
      />
      <span className="absolute text-2xs font-semibold leading-none tabular-nums opacity-0 transition-opacity duration-150 group-hover/update:opacity-100 group-focus-visible/update:opacity-100">
        {roundedProgress}%
      </span>
    </button>
  );
}

const ProfileUsageControl = React.memo(function ProfileUsageControl({
  name,
  image,
  percentage,
  label,
  collapsed = false,
  usage,
}: {
  name: string;
  image?: string | null;
  percentage: number | null;
  label: string;
  collapsed?: boolean;
  usage: NonNullable<ReturnType<typeof useUsage>>;
}) {
  const [open, setOpen] = React.useState(false);
  const showUsageOnHover = percentage !== null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "group relative flex h-10 min-w-0 items-center gap-2.5 rounded-md py-0.5 text-left outline-none transition-[width,padding,opacity] duration-200 ease-out hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-foreground/20 dark:hover:bg-white/[0.06]",
            collapsed ? "mx-auto size-10 justify-center gap-0 px-0" : "w-full px-2.5"
          )}
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
          <span
            aria-hidden={collapsed}
            className={cn(
              "min-w-0 flex-1 overflow-hidden transition-opacity duration-150",
              collapsed ? "pointer-events-none absolute opacity-0" : "opacity-100"
            )}
          >
              <span className="block truncate text-sm font-medium leading-5">{name}</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        forceMount
        side="top"
        align="start"
        sideOffset={10}
        className="w-[min(20rem,calc(100vw-2rem))] p-4"
      >
        <UsageDisplay surface="profile" autoRefresh={open} usageState={usage} />
      </PopoverContent>
    </Popover>
  );
});

function ProfileIdentitySkeleton({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2.5",
        collapsed ? "mx-auto size-10 justify-center" : "w-full px-2.5"
      )}
      aria-busy="true"
    >
      <span className="relative size-10 shrink-0">
        <span className="absolute inset-0 rounded-full border-2 border-foreground/10" />
        <span className="absolute inset-1.5 animate-pulse rounded-full bg-foreground/10" />
      </span>
      {!collapsed && <span className="h-4 w-24 animate-pulse rounded bg-foreground/10" />}
    </div>
  );
}

export default function ControlPanelSidebar({
  activeView,
  collapsed,
  onToggleCollapsed,
  onViewChange,
  onOpenSettings,
  onOpenSearch,
  userName,
  userImage,
  isSignedIn,
  authLoaded,
  usageState,
  updateAction,
}: ControlPanelSidebarProps) {
  const { t } = useTranslation();
  // Keep a local fallback for isolated previews/tests, but normal application
  // usage is owned by ControlPanel so opening the profile menu does no new work.
  const fallbackUsage = useUsage({
    loadOnMount: usageState === undefined,
    auth: usageState !== undefined ? { isSignedIn: false, user: null } : undefined,
  });
  const usage = usageState === undefined ? fallbackUsage : usageState;
  const profileName = userName || t("sidebar.defaultUser", { defaultValue: "VoiceLab user" });
  const usagePercentage = usedUsagePercentage(usage);
  const isProfileLoading = !authLoaded || (isSignedIn === true && usage === null);
  const primaryItems = [
    {
      id: "home" as const,
      label: t("desktop.nav.history", { defaultValue: "History" }),
      icon: historyIcon,
    },
    {
      id: "dictionary" as const,
      label: t("desktop.nav.vocabulary", { defaultValue: "Vocabulary" }),
      icon: bookmarkIcon,
    },
    ...(VOICELAB_AI_ENABLED
      ? [
          {
            id: "chat" as const,
            label: "VoiceLab AI",
            icon: speechToTextIcon,
          },
        ]
      : []),
    {
      id: "personal-notes" as const,
      label: t("sidebar.notes", { defaultValue: "Notes" }),
      icon: notesIcon,
    },
  ];

  const renderItem = ({
    id,
    label,
    icon,
  }: (typeof primaryItems)[number]) => {
    const active = activeView === id;
    return (
      <button
        key={id}
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={() => onViewChange(id)}
        title={collapsed ? label : undefined}
        className={cn(
          navButton,
          collapsed && "mx-auto size-10 min-h-0 justify-center px-0",
          active
            ? "bg-black/[0.055] font-medium text-foreground dark:bg-white/[0.08]"
            : "text-foreground/60 hover:bg-black/[0.035] hover:text-foreground dark:text-foreground/65 dark:hover:bg-white/[0.06]"
        )}
      >
        <VoiceLabIcon
          source={icon}
          className={cn(
            "size-[18px] transition-opacity",
            active ? "text-foreground" : "text-foreground/55 group-hover:text-foreground/80"
          )}
        />
        {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      </button>
    );
  };

  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden border-r border-black/10 bg-white text-foreground transition-[width] duration-200 ease-out dark:border-white/12 dark:bg-[#171717]"
      style={{
        width: collapsed ? CONTROL_PANEL_SIDEBAR_RAIL_WIDTH_PX : CONTROL_PANEL_SIDEBAR_WIDTH_PX,
      }}
    >
      <div className="h-12 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />

      <div className={cn("px-3 pb-4", collapsed && "flex justify-center")}>
        {onOpenSearch ? (
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label={
              collapsed
                ? t("commandSearch.shortPlaceholder", { defaultValue: "Search" })
                : undefined
            }
            title={
              collapsed
                ? t("commandSearch.shortPlaceholder", { defaultValue: "Search" })
                : undefined
            }
            className={cn(
              "flex h-8 items-center rounded-[10px] border border-black/10 bg-white text-sm text-foreground/50 outline-none transition-colors hover:bg-black/[0.025] hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-foreground/15 dark:border-white/15 dark:bg-transparent dark:text-foreground/60 dark:hover:bg-white/[0.06] dark:hover:text-foreground/85",
              collapsed ? "w-8 justify-center px-0" : "w-full px-2.5"
            )}
          >
            {collapsed ? (
              <VoiceLabIcon source={searchIcon} className="size-4" />
            ) : (
              <>
                <VoiceLabIcon source={searchIcon} className="mr-2 size-4 text-current" />
                <span className="flex-1 text-left">
                  {t("commandSearch.shortPlaceholder", { defaultValue: "Search" })}
                </span>
                <span className="flex items-center gap-1 opacity-65" aria-hidden="true">
                  {(platform === "darwin" ? ["⌘", "K"] : ["Ctrl", "K"]).map((key) => (
                    <kbd
                      key={key}
                      className="flex h-6 min-w-6 items-center justify-center rounded-[5px] border border-current/15 px-1.5 text-xs font-medium leading-none"
                    >
                      {key}
                    </kbd>
                  ))}
                </span>
              </>
            )}
          </button>
        ) : (
          <div className="h-8" />
        )}
      </div>

      <nav aria-label="VoiceLab" className="px-3">
        <div aria-hidden="true" className="h-3" />
        <div className="space-y-0.5">{primaryItems.map(renderItem)}</div>
      </nav>

      <div className="flex-1" />

      <div
        className={cn(
          "relative shrink-0 overflow-hidden border-t border-black/10 transition-[height,padding] duration-200 ease-out dark:border-white/12",
          collapsed
              ? updateAction
              ? "h-[172px] p-2"
              : "h-32 p-2"
            : "h-16 p-3"
        )}
      >
        <div className="relative size-full">
          <div
            className={cn(
              "absolute transition-[left,top,width,transform] duration-200 ease-out",
              collapsed
                ? "left-1/2 top-0 w-10 -translate-x-1/2"
                : updateAction
                  ? "left-2.5 top-0 w-[calc(100%-6.75rem)] translate-x-0"
                  : "left-2.5 top-0 w-[calc(100%-4.5rem)] translate-x-0"
            )}
          >
            {isProfileLoading ? (
              <ProfileIdentitySkeleton collapsed={collapsed} />
            ) : isSignedIn && usage ? (
              <ProfileUsageControl
                name={profileName}
                image={userImage}
                percentage={usagePercentage}
                label={`${profileName}: ${t("desktop.wallet.title")}`}
                collapsed={collapsed}
                usage={usage}
              />
            ) : (
              <div
                className={cn(
                  "flex h-10 min-w-0 items-center gap-2.5 transition-[width,padding] duration-200 ease-out",
                  collapsed ? "mx-auto size-10 justify-center px-0" : "w-full px-2.5"
                )}
              >
                <span className="relative size-8 shrink-0 overflow-hidden rounded-full border border-black/8 bg-[#f8f8f8] dark:border-white/12 dark:bg-white/12">
                  <ProfileAvatar name={profileName} image={userImage} />
                </span>
                <p
                  aria-hidden={collapsed}
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm leading-5 text-muted-foreground transition-opacity duration-150",
                    collapsed ? "opacity-0" : "opacity-100"
                  )}
                >
                  {t("sidebar.notSignedIn", { defaultValue: "Not signed in" })}
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={t("sidebar.settings", { defaultValue: "Settings" })}
            title={t("sidebar.settings", { defaultValue: "Settings" })}
            className={cn(
              "absolute flex size-8 items-center justify-center rounded-md text-foreground/55 outline-none transition-[left,top,transform,color,background-color] duration-200 ease-out hover:bg-black/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20 dark:text-foreground/65 dark:hover:bg-white/[0.08]",
              collapsed
                ? "left-1/2 top-11 -translate-x-1/2"
                : updateAction
                  ? "left-[calc(100%-6.5rem)] top-1 translate-x-0"
                  : "left-[calc(100%-4.25rem)] top-1 translate-x-0"
            )}
          >
            <VoiceLabIcon source={settingsIcon} className="size-[18px]" />
          </button>

          {updateAction && (
            <div
              className={cn(
                "absolute transition-[left,top,transform] duration-200 ease-out",
                collapsed
                  ? "left-1/2 top-20 -translate-x-1/2"
                  : "left-[calc(100%-4.25rem)] top-1 translate-x-0"
              )}
            >
              <UpdateActionButton {...updateAction} />
            </div>
          )}

          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={t(collapsed ? "sidebar.expand" : "sidebar.collapse")}
            title={t(collapsed ? "sidebar.expand" : "sidebar.collapse")}
            className={cn(
              "absolute flex size-8 items-center justify-center rounded-md text-foreground/55 outline-none transition-[left,top,transform,color,background-color] duration-200 ease-out hover:bg-black/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20 dark:text-foreground/65 dark:hover:bg-white/[0.08]",
              collapsed
                ? updateAction
                  ? "left-1/2 top-[7.75rem] -translate-x-1/2"
                  : "left-1/2 top-20 -translate-x-1/2"
                : "left-[calc(100%-2rem)] top-1 translate-x-0"
            )}
          >
            <VoiceLabIcon
              source={collapsed ? sidebarClosedIcon : sidebarOpenIcon}
              className="size-[18px]"
            />
          </button>
        </div>
      </div>
    </aside>
  );
}
