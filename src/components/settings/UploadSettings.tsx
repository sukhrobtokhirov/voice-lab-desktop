import { useTranslation } from "react-i18next";
import { Cloud } from "lucide-react";
import { SettingsPanel, SettingsPanelRow } from "../ui/SettingsSection";
import { Badge } from "../ui/badge";

/** Aisha-only upload STT — no BYOK / local picker. */
export function UploadTranscriptionPanel() {
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
    </div>
  );
}
