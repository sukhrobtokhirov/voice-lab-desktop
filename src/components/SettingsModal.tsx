import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { UserCircle, Wrench, SlidersHorizontal } from "lucide-react";
import SidebarModal, { type SidebarItem } from "./ui/SidebarModal";
import SettingsPage, { SettingsSectionType } from "./SettingsPage";
import keyboardIcon from "../assets/icons/keyboard.svg";
import type { VoiceLabUser } from "../lib/auth";
import type { UseUsageResult } from "../hooks/useUsage";

export type { SettingsSectionType };

// Legacy deep-links land on the matching visible settings section via SECTION_ALIASES.
const SECTION_ALIASES: Record<string, SettingsSectionType> = {
  aiModels: "llms",
  agentConfig: "llms",
  agentMode: "llms",
  intelligence: "llms",
  meetings: "llms",
  prompts: "llms",
  softwareUpdates: "system",
  developer: "system",
  plansBilling: "account",
  llms: "system",
  workspace: "account",
};

const CANONICAL_SECTIONS = new Set<SettingsSectionType>([
  "account",
  "general",
  "hotkeys",
  "system",
]);

const LEGACY_SUB_TAB: Record<string, string> = {
  meetings: "noteFormatting",
  intelligence: "dictationCleanup",
  agentMode: "chatIntelligence",
  agentConfig: "chatIntelligence",
  aiModels: "dictationCleanup",
  prompts: "dictationCleanup",
};

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: string;
  auth: {
    isSignedIn: boolean;
    isLoaded: boolean;
    user: VoiceLabUser | null;
  };
  usageState?: UseUsageResult | null;
}

export default function SettingsModal({
  open,
  onOpenChange,
  initialSection,
  auth,
  usageState,
}: SettingsModalProps) {
  const { t } = useTranslation();
  const sidebarItems: SidebarItem<SettingsSectionType>[] = useMemo(
    () => [
      {
        id: "account",
        label: t("desktop.settings.account", { defaultValue: "Account" }),
        icon: UserCircle,
        group: t("settingsModal.groups.account", { defaultValue: "VoiceLab" }),
      },
      {
        id: "general",
        label: t("settingsModal.sections.general.label", { defaultValue: "Preferences" }),
        icon: SlidersHorizontal,
        description: t("settingsModal.sections.general.description", {
          defaultValue: "Appearance, language and app behavior",
        }),
        group: t("settingsModal.groups.app", { defaultValue: "Flow" }),
      },
      {
        id: "hotkeys",
        label: t("desktop.settings.shortcuts", { defaultValue: "Shortcuts" }),
        icon: keyboardIcon,
        description: t("desktop.settings.shortcutsDescription", {
          defaultValue: "Dictation and VoiceLab AI shortcuts",
        }),
        group: t("settingsModal.groups.app", { defaultValue: "Flow" }),
      },
      {
        id: "system",
        label: t("desktop.settings.advanced", { defaultValue: "Advanced" }),
        icon: Wrench,
        description: t("desktop.settings.advancedDescription", {
          defaultValue: "VoiceLab Cloud and developer tools",
        }),
        group: t("settingsModal.groups.system", { defaultValue: "System" }),
      },
    ],
    [t]
  );

  const resolveSection = (section: string | undefined): SettingsSectionType => {
    if (!section) return "account";
    const resolved = (SECTION_ALIASES[section] ?? section) as SettingsSectionType;
    return CANONICAL_SECTIONS.has(resolved) ? resolved : "account";
  };

  const [activeSection, setActiveSection] = React.useState<SettingsSectionType>(() =>
    resolveSection(initialSection)
  );
  const [initialSubTab, setInitialSubTab] = useState<string | undefined>(() =>
    initialSection ? LEGACY_SUB_TAB[initialSection] : undefined
  );
  useEffect(() => {
    if (!open) {
      setInitialSubTab(undefined);
      return;
    }
    if (!initialSection) return;
    setActiveSection(resolveSection(initialSection));
    setInitialSubTab(LEGACY_SUB_TAB[initialSection]);
  }, [initialSection, open]);

  const handleSectionChange = (section: SettingsSectionType) => {
    setActiveSection(section);
    setInitialSubTab(undefined);
  };

  return (
    <SidebarModal<SettingsSectionType>
      open={open}
      onOpenChange={onOpenChange}
      title={t("settingsModal.title")}
      sidebarItems={sidebarItems}
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
      sidebarWidth="w-60"
    >
      <SettingsPage
        activeSection={activeSection}
        onNavigateToSection={handleSectionChange}
        initialSubTab={initialSubTab}
        auth={auth}
        usageState={usageState}
      />
    </SidebarModal>
  );
}
