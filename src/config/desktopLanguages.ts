export type DesktopLanguageCode = "auto" | "uz" | "kk" | "ky" | "tg" | "tk" | "ru" | "en";
export type DesktopLanguageProvider = "aisha" | "whisper" | "unknown";

export interface DesktopLanguageDefinition {
  code: DesktopLanguageCode;
  label: string;
  localizedName: string;
  flag: string;
  group: "automatic" | "central-asia" | "other";
}

export const DESKTOP_LANGUAGE_CATALOG: readonly DesktopLanguageDefinition[] = [
  { code: "auto", label: "Auto", localizedName: "Avtomatik aniqlash", flag: "✨", group: "automatic" },
  { code: "uz", label: "Uzbek", localizedName: "O‘zbekcha", flag: "🇺🇿", group: "central-asia" },
  { code: "kk", label: "Kazakh", localizedName: "Қазақша", flag: "🇰🇿", group: "central-asia" },
  { code: "ky", label: "Kyrgyz", localizedName: "Кыргызча", flag: "🇰🇬", group: "central-asia" },
  { code: "tg", label: "Tajik", localizedName: "Тоҷикӣ", flag: "🇹🇯", group: "central-asia" },
  { code: "tk", label: "Turkmen", localizedName: "Türkmençe", flag: "🇹🇲", group: "central-asia" },
  { code: "ru", label: "Russian", localizedName: "Русский", flag: "🇷🇺", group: "other" },
  { code: "en", label: "English", localizedName: "English", flag: "🇬🇧", group: "other" },
] as const;

const CANONICAL_CODES = new Set(DESKTOP_LANGUAGE_CATALOG.map((language) => language.code));

export interface DesktopLanguageCapabilities {
  supportedLanguages?: readonly string[];
  autoDetectionSupported?: boolean;
}

export function normalizeDesktopLanguage(value: unknown): DesktopLanguageCode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return CANONICAL_CODES.has(normalized as DesktopLanguageCode)
    ? (normalized as DesktopLanguageCode)
    : null;
}

export function providerSupportsLanguage(
  provider: DesktopLanguageProvider,
  code: DesktopLanguageCode,
  capabilities?: DesktopLanguageCapabilities
): boolean {
  if (provider === "aisha") {
    if (!capabilities) return true;
    if (code === "auto") {
      return capabilities.autoDetectionSupported === undefined
        ? true
        : capabilities.autoDetectionSupported;
    }
    if (!capabilities.supportedLanguages) return true;
    return capabilities.supportedLanguages.includes(code);
  }
  if (provider === "whisper") return true;
  return code !== "auto";
}

export function languageUnsupportedReason(
  provider: DesktopLanguageProvider,
  code: DesktopLanguageCode,
  capabilities?: DesktopLanguageCapabilities
): string | undefined {
  if (providerSupportsLanguage(provider, code, capabilities)) return undefined;
  if (provider === "aisha") {
    return code === "auto"
      ? "Automatic detection is not available for VoiceLab Cloud yet."
      : "This language is not available for the connected VoiceLab Cloud service.";
  }
  return "Automatic detection is not confirmed for this provider.";
}

export function toTransportLanguage(
  value: unknown,
  provider: DesktopLanguageProvider,
  capabilities?: DesktopLanguageCapabilities
): Exclude<DesktopLanguageCode, "auto"> | null {
  const code = normalizeDesktopLanguage(value);
  if (!code || !providerSupportsLanguage(provider, code, capabilities)) return null;
  return code === "auto" ? null : code;
}
