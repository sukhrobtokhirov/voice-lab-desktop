import React from "react";
import {
  BookOpen,
  History,
  MessageSquare,
  NotebookPen,
  Search,
  Settings,
  UserCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
import UsageDisplay from "./UsageDisplay";
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
  userEmail?: string | null;
  userImage?: string | null;
  isSignedIn?: boolean;
  authLoaded?: boolean;
  updateAction?: React.ReactNode;
}

const navButton =
  "group flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[15px] font-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/20";

export default function ControlPanelSidebar({
  activeView,
  onViewChange,
  onOpenSettings,
  onOpenSearch,
  userName,
  userEmail,
  userImage,
  isSignedIn,
  authLoaded,
  updateAction,
}: ControlPanelSidebarProps) {
  const { t } = useTranslation();
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
            className="flex h-8 w-full items-center gap-2 rounded-[10px] border border-black/10 bg-white px-2.5 text-[13px] text-foreground/50 outline-none transition-colors hover:bg-black/[0.025] hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-foreground/15 dark:border-white/15 dark:bg-transparent dark:text-foreground/60 dark:hover:bg-white/[0.06] dark:hover:text-foreground/85"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">
              {t("commandSearch.shortPlaceholder", { defaultValue: "Search" })}
            </span>
            <kbd className="rounded-[5px] border border-current/15 px-1.5 py-0.5 text-[10px] font-medium opacity-65">
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

      <div className="space-y-2 border-t border-black/10 p-3 dark:border-white/12">
        {updateAction}
        {isSignedIn && <UsageDisplay compact />}

        <button
          type="button"
          onClick={onOpenSettings}
          className={cn(
            navButton,
            "text-foreground/60 hover:bg-black/[0.035] hover:text-foreground dark:text-foreground/65 dark:hover:bg-white/[0.06]"
          )}
        >
          <Settings className="h-[18px] w-[18px] text-foreground/55" />
          <span>{t("sidebar.settings", { defaultValue: "Settings" })}</span>
        </button>

        <div className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5">
          {userImage ? (
            <img src={userImage} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
          ) : (
            <UserCircle className="h-6 w-6 shrink-0 text-foreground/45" />
          )}
          <div className="min-w-0 flex-1">
            {isSignedIn ? (
              <>
                <p className="truncate text-[13px] font-medium">
                  {userName || t("sidebar.defaultUser", { defaultValue: "VoiceLab user" })}
                </p>
                {userEmail && <p className="truncate text-xs text-muted-foreground">{userEmail}</p>}
              </>
            ) : authLoaded ? (
              <p className="text-[13px] text-muted-foreground">
                {t("sidebar.notSignedIn", { defaultValue: "Not signed in" })}
              </p>
            ) : (
              <div className="h-4 w-24 animate-pulse rounded bg-foreground/10" />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
