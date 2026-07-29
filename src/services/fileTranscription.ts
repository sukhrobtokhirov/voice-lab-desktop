import { withSessionRefresh } from "../lib/auth";

export interface FileTranscriptionResult {
  success: boolean;
  text?: string;
  error?: string;
  code?: string;
  diarized?: boolean;
  warning?: string;
}

export interface DiarizationSettings {
  enabled: boolean;
  localModelsReady: boolean;
  numSpeakers: number | null;
}

export interface FileTranscriptionConfig {
  useLocalWhisper: boolean;
  localTranscriptionProvider: string;
  whisperModel: string;
  parakeetModel: string;
  isOpenWhisprCloud: boolean;
  getApiKey: () => string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionBaseUrl: string;
  cloudTranscriptionModel: string;
  language: string;
  cortiEnvironment?: string;
  cortiTenant?: string;
  transcriptionMode?: string;
  remoteTranscriptionUrl?: string;
  remoteTranscriptionModel?: string;
}

function explicitLanguage(language: string): string | undefined {
  return language === "auto" ? undefined : language;
}

export async function transcribeFile(
  filePath: string,
  cfg: FileTranscriptionConfig,
  diarize: boolean
): Promise<FileTranscriptionResult> {
  if (cfg.isOpenWhisprCloud) {
    return withSessionRefresh(async () => {
      const result = await window.electronAPI.transcribeAudioFileCloud!(filePath, {
        language: explicitLanguage(cfg.language) ?? null,
      });
      if (!result.success && result.code) {
        throw Object.assign(new Error(result.error || "Cloud transcription failed"), {
          code: result.code,
        });
      }
      return result;
    });
  }

  if (cfg.useLocalWhisper) {
    return window.electronAPI.transcribeAudioFile(filePath, {
      provider: cfg.localTranscriptionProvider === "nvidia" ? "nvidia" : "whisper",
      model: cfg.localTranscriptionProvider === "nvidia" ? cfg.parakeetModel : cfg.whisperModel,
      language: explicitLanguage(cfg.language),
    });
  }

  const result = await window.electronAPI.transcribeAudioFileByok?.({
    filePath,
    apiKey: cfg.getApiKey(),
    baseUrl: cfg.cloudTranscriptionBaseUrl,
    model: cfg.cloudTranscriptionModel,
    diarize,
    provider: cfg.cloudTranscriptionProvider,
    language: explicitLanguage(cfg.language),
    environment: cfg.cortiEnvironment,
    tenant: cfg.cortiTenant,
    transcriptionMode: cfg.transcriptionMode,
    remoteTranscriptionUrl: cfg.remoteTranscriptionUrl,
    remoteTranscriptionModel: cfg.remoteTranscriptionModel,
  });
  return result ?? { success: false, error: "Selected transcription provider is unavailable" };
}

export function shouldUseByokDiarize(
  cfg: FileTranscriptionConfig,
  diarizationEnabled: boolean
): boolean {
  if (!diarizationEnabled || cfg.useLocalWhisper || cfg.isOpenWhisprCloud) return false;
  if (cfg.transcriptionMode === "self-hosted") return false;
  return cfg.cloudTranscriptionProvider === "openai" || cfg.cloudTranscriptionProvider === "mistral";
}

export async function transcribeFileWithSpeakers(
  filePath: string,
  cfg: FileTranscriptionConfig,
  diarization: DiarizationSettings,
  durationSeconds?: number | null
): Promise<FileTranscriptionResult> {
  const byokDiarize = shouldUseByokDiarize(cfg, diarization.enabled);
  const diarizePromise =
    diarization.enabled && diarization.localModelsReady && !byokDiarize
      ? (window.electronAPI
          .diarizeAudioFile?.(filePath, { numSpeakers: diarization.numSpeakers ?? undefined })
          .catch(() => null) ?? Promise.resolve(null))
      : Promise.resolve(null);
  const [result, diar] = await Promise.all([transcribeFile(filePath, cfg, byokDiarize), diarizePromise]);
  if (!result.success || !result.text || result.diarized) return result;
  if (!diar?.success || !diar.segments?.length) return result;
  try {
    const merged = await window.electronAPI.mergeSpeakerText?.(diar.segments, result.text, durationSeconds || 0);
    if (merged?.success && merged.text) return { ...result, text: merged.text };
  } catch {
    // A merge failure still returns the valid plain transcript.
  }
  return result;
}
