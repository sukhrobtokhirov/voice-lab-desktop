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
  language: string;
}

function explicitLanguage(language: string): string | undefined {
  return language === "auto" ? undefined : language;
}

export async function transcribeFile(
  filePath: string,
  cfg: FileTranscriptionConfig,
  _diarize: boolean
): Promise<FileTranscriptionResult> {
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

export function shouldUseByokDiarize(
  _cfg: FileTranscriptionConfig,
  _diarizationEnabled: boolean
): boolean {
  return false;
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
