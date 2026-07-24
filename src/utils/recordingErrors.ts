import { TFunction } from "i18next";

type RecordingError = {
  code?: string;
  title: string;
  description?: string;
  messageKey?: string;
};

export function getRecordingErrorTitle(error: RecordingError, t: TFunction): string {
  if (error.code === "NETWORK_ERROR") return t(error.title);
  if (error.code === "AUTH_EXPIRED" || error.code === "AUTH_REQUIRED") {
    return t("hooks.audioRecording.errorTitles.sessionExpired");
  }
  if (error.code === "API_KEY_MISSING") {
    return t("settingsPage.account.aishaKey.missingTitle");
  }
  if (error.code === "OFFLINE") return t("hooks.audioRecording.errorTitles.offline");
  if (error.code === "LIMIT_REACHED")
    return t("hooks.audioRecording.errorTitles.aishaBillingFailed");
  if (error.code === "PROVIDER_RATE_LIMITED")
    return t("hooks.audioRecording.errorTitles.providerRateLimited");
  if (error.messageKey === "hooks.audioRecording.errorDescriptions.aishaBillingRetry") {
    return t("hooks.audioRecording.errorTitles.aishaBillingRetry");
  }
  return error.title;
}

export function getRecordingErrorDescription(error: RecordingError, t: TFunction): string {
  if (error.messageKey) return t(error.messageKey);
  return error.description ?? "";
}
