import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import ApiKeyInput from "../ui/ApiKeyInput";
import { Alert, AlertDescription } from "../ui/alert";

const AISHA_SPACE_URL = "https://space.aisha.group";

interface AishaKeyStepProps {
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  error?: string | null;
  validating?: boolean;
}

export default function AishaKeyStep({
  apiKey,
  onApiKeyChange,
  error = null,
  validating = false,
}: AishaKeyStepProps) {
  const { t } = useTranslation();
  const [localKey, setLocalKey] = useState(apiKey);

  useEffect(() => {
    setLocalKey(apiKey);
  }, [apiKey]);

  const setKey = useCallback(
    (key: string) => {
      setLocalKey(key);
      onApiKeyChange(key);
    },
    [onApiKeyChange]
  );

  const openSpace = () => {
    void window.electronAPI?.openExternal?.(AISHA_SPACE_URL);
  };

  return (
    <div className="space-y-5">
      <div className="text-center space-y-1">
        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
          <KeyRound className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-lg font-semibold text-foreground tracking-tight">
          {t("onboarding.aishaKey.title")}
        </h2>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          {t("onboarding.aishaKey.description")}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface-1 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t("onboarding.aishaKey.getKeyHint")}</p>
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={openSpace}>
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            {t("onboarding.aishaKey.openSpace")}
          </Button>
        </div>

        <ApiKeyInput
          apiKey={localKey}
          setApiKey={setKey}
          label={t("onboarding.aishaKey.inputLabel")}
          placeholder={t("onboarding.aishaKey.placeholder")}
          helpText={t("onboarding.aishaKey.helpText")}
        />

        {validating && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t("onboarding.aishaKey.validating")}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

export { AISHA_SPACE_URL };
