import {
  DESKTOP_LANGUAGE_CATALOG,
  languageUnsupportedReason,
  providerSupportsLanguage,
  type DesktopLanguageCapabilities,
  type DesktopLanguageProvider,
} from "./desktopLanguages";

export interface LanguageOption {
  value: string;
  label: string;
  flag: string;
  localizedName?: string;
  group?: "automatic" | "central-asia" | "other";
  disabled?: boolean;
  disabledReason?: string;
}

export function getDesktopLanguageOptions(
  provider: DesktopLanguageProvider,
  capabilities?: DesktopLanguageCapabilities
): LanguageOption[] {
  return DESKTOP_LANGUAGE_CATALOG.map((language) => ({
    value: language.code,
    label: language.label,
    localizedName: language.localizedName,
    flag: language.flag,
    group: language.group,
    disabled: !providerSupportsLanguage(provider, language.code, capabilities),
    disabledReason: languageUnsupportedReason(provider, language.code, capabilities),
  }));
}
