import { useTranslation } from "react-i18next";
import { Cloud } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";
import { Toggle } from "../ui/toggle";
import { Badge } from "../ui/badge";

export function MeetingSpeakerDetectionRow() {
  const { t } = useTranslation();
  const speakerDiarizationEnabled = useSettingsStore((s) => s.speakerDiarizationEnabled);
  const setSpeakerDiarizationEnabled = useSettingsStore((s) => s.setSpeakerDiarizationEnabled);

  return (
    <SettingsRow
      label={t("settings.meeting.speakerDetection.title")}
      description={t("settings.meeting.speakerDetection.description")}
    >
      <Toggle checked={speakerDiarizationEnabled} onChange={setSpeakerDiarizationEnabled} />
    </SettingsRow>
  );
}

/** Aisha-only meeting STT — no BYOK / local / self-hosted picker. */
export function MeetingTranscriptionPanel() {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <SettingsPanel>
        <SettingsPanelRow>
          <div className="flex items-start gap-3 w-full">
            <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Cloud className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">
                  {t("settingsPage.transcription.modes.openwhispr")}
                </p>
                <Badge variant="success">Aisha</Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("settingsPage.transcription.modes.openwhisprDesc")}
              </p>
            </div>
          </div>
        </SettingsPanelRow>
      </SettingsPanel>
      <SettingsPanel>
        <SettingsPanelRow>
          <MeetingSpeakerDetectionRow />
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}
