import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, UserCircle, Wrench, Keyboard, Shield } from "lucide-react";
import SidebarModal, { type SidebarItem } from "./ui/SidebarModal";
import SettingsPage, { SettingsSectionType } from "./SettingsPage";

export type { SettingsSectionType };

// The old AI Models sidebar had four items (transcription, meetings,
// intelligence, agentMode) — they now collapse into two: speechToText + llms.
// Legacy deep-links land on the matching sub-tab via LEGACY_SUB_TAB.
const SECTION_ALIASES: Record<string, SettingsSectionType> = {
  aiModels: "llms",
  agentConfig: "llms",
  agentMode: "llms",
  intelligence: "llms",
  meetings: "llms",
  prompts: "llms",
  transcription: "speechToText",
  uploadTranscription: "speechToText",
  softwareUpdates: "system",
  privacy: "privacyData",
  permissions: "privacyData",
  developer: "system",
  plansBilling: "account",
  general: "speechToText",
  llms: "system",
  workspace: "account",
};

const CANONICAL_SECTIONS = new Set<SettingsSectionType>([
  "account",
  "speechToText",
  "hotkeys",
  "privacyData",
  "system",
]);

const LEGACY_SUB_TAB: Record<string, string> = {
  transcription: "dictation",
  uploadTranscription: "upload",
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
}

export default function SettingsModal({ open, onOpenChange, initialSection }: SettingsModalProps) {
  const { t } = useTranslation();
  const sidebarItems: SidebarItem<SettingsSectionType>[] = useMemo(
    () => [
      {
        id: "account",
        label: t("desktop.settings.account", { defaultValue: "Account & Credits" }),
        icon: UserCircle,
        description: t("desktop.settings.accountDescription", {
          defaultValue: "Profile, secure session and billing",
        }),
        group: t("settingsModal.groups.account", { defaultValue: "VoiceLab" }),
      },
      {
        id: "speechToText",
        label: t("desktop.settings.dictation", { defaultValue: "Dictation" }),
        icon: Mic,
        description: t("desktop.settings.dictationDescription", {
          defaultValue: "Language, microphone and paste behavior",
        }),
        group: t("settingsModal.groups.app", { defaultValue: "Dictate" }),
      },
      {
        id: "hotkeys",
        label: t("desktop.settings.shortcuts", { defaultValue: "Shortcuts" }),
        icon: Keyboard,
        description: t("desktop.settings.shortcutsDescription", {
          defaultValue: "Dictation and VoiceLab AI shortcuts",
        }),
        group: t("settingsModal.groups.app", { defaultValue: "Dictate" }),
      },
      {
        id: "privacyData",
        label: t("desktop.settings.privacy", { defaultValue: "Data & Privacy" }),
        icon: Shield,
        description: t("desktop.settings.privacyDescription", {
          defaultValue: "Cloud backup, local audio and retention",
        }),
        group: t("settingsModal.groups.system", { defaultValue: "System" }),
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
      />
    </SidebarModal>
  );
}
