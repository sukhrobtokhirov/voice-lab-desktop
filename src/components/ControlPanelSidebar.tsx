import React, { useState } from "react";
import {
  BookOpen,
  Blocks,
  ChevronDown,
  History,
  MessageSquare,
  MoreHorizontal,
  NotebookPen,
  Search,
  Settings,
  Upload,
  UserCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
import UsageDisplay from "./UsageDisplay";
import { getCachedPlatform } from "../utils/platform";

const platform = getCachedPlatform();

export type ControlPanelView =
  | "home"
  | "chat"
  | "personal-notes"
  | "dictionary"
  | "upload"
  | "integrations";

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
  "group flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#e55347]/35";

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
  const [moreOpen, setMoreOpen] = useState(
    () => activeView === "upload" || activeView === "integrations"
  );

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
    {
      id: "chat" as const,
      label: "Aisha",
      icon: MessageSquare,
    },
    {
      id: "personal-notes" as const,
      label: t("sidebar.notes", { defaultValue: "Notes" }),
      icon: NotebookPen,
    },
  ];

  const secondaryItems = [
    {
      id: "upload" as const,
      label: t("sidebar.upload", { defaultValue: "Upload" }),
      icon: Upload,
    },
    {
      id: "integrations" as const,
      label: t("sidebar.integrations", { defaultValue: "Integrations" }),
      icon: Blocks,
    },
  ];

  const renderItem = ({ id, label, icon: Icon }: (typeof primaryItems)[number] | (typeof secondaryItems)[number]) => {
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
            ? "bg-[#e55347]/10 font-semibold text-[#b93d34] dark:bg-[#ff6b60]/12 dark:text-[#ff8b82]"
            : "text-foreground/75 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/6"
        )}
      >
        <Icon className={cn("h-[18px] w-[18px]", active ? "text-[#e55347]" : "text-foreground/50")} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    );
  };

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-[#e6ddd1] bg-[#f5f0e8] text-foreground dark:border-white/8 dark:bg-[#171513]">
      <div className="h-11 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />

      <div className="px-3 pb-3">
        {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex h-10 w-full items-center gap-2 rounded-xl border border-[#ded4c7] bg-white/55 px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-[#e55347]/30 dark:border-white/10 dark:bg-white/4 dark:hover:bg-white/7"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">
              {t("commandSearch.shortPlaceholder", { defaultValue: "Search" })}
            </span>
            <kbd className="rounded-md border border-current/15 px-1.5 py-0.5 text-xs opacity-60">
              {platform === "darwin" ? "⌘K" : "Ctrl K"}
            </kbd>
          </button>
        )}
      </div>

      <nav aria-label="VoiceLab" className="space-y-1 px-3">
        {primaryItems.map(renderItem)}
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((value) => !value)}
          className={cn(
            navButton,
            activeView === "upload" || activeView === "integrations"
              ? "text-foreground"
              : "text-foreground/75 hover:bg-black/5 dark:hover:bg-white/6"
          )}
        >
          <MoreHorizontal className="h-[18px] w-[18px] text-foreground/50" />
          <span className="flex-1">{t("desktop.nav.more", { defaultValue: "More" })}</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", moreOpen && "rotate-180")} />
        </button>
        {moreOpen && (
          <div className="ml-4 space-y-1 border-l border-[#ded4c7] pl-2 dark:border-white/10">
            {secondaryItems.map(renderItem)}
          </div>
        )}
      </nav>

      <div className="flex-1" />

      <div className="space-y-3 border-t border-[#e6ddd1] p-3 dark:border-white/8">
        {updateAction}
        {isSignedIn && <UsageDisplay compact />}

        <button type="button" onClick={onOpenSettings} className={cn(navButton, "text-foreground/75 hover:bg-black/5 dark:hover:bg-white/6")}>
          <Settings className="h-[18px] w-[18px] text-foreground/50" />
          <span>{t("sidebar.settings", { defaultValue: "Settings" })}</span>
        </button>

        <div className="flex min-h-11 items-center gap-3 rounded-xl px-3">
          {userImage ? (
            <img src={userImage} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
          ) : (
            <UserCircle className="h-7 w-7 shrink-0 text-foreground/45" />
          )}
          <div className="min-w-0 flex-1">
            {isSignedIn ? (
              <>
                <p className="truncate text-sm font-medium">{userName || t("sidebar.defaultUser", { defaultValue: "VoiceLab user" })}</p>
                {userEmail && <p className="truncate text-xs text-muted-foreground">{userEmail}</p>}
              </>
            ) : authLoaded ? (
              <p className="text-sm text-muted-foreground">{t("sidebar.notSignedIn", { defaultValue: "Not signed in" })}</p>
            ) : (
              <div className="h-4 w-24 animate-pulse rounded bg-foreground/10" />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
