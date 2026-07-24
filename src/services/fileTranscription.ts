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
  // Local sherpa-onnx models present; BYOK-native diarization doesn't need them.
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

// Single provider dispatch shared by the single-file flow and the batch queue,
// so BYOK providers receive identical options in both.
export async function transcribeFile(
  filePath: string,
  _cfg: FileTranscriptionConfig,
  _diarize: boolean
): Promise<FileTranscriptionResult> {
  // Aisha-only — always VoiceLab Cloud file transcription.
  return withSessionRefresh(async () => {
    const r = await window.electronAPI.transcribeAudioFileCloud!(filePath);
    if (!r.success && r.code) {
      throw Object.assign(new Error(r.error || "Cloud transcription failed"), {
        code: r.code,
      });
    }
    return r;
  });
}

// OpenAI/Mistral BYOK handle diarization inside the transcription call itself.
// Self-hosted mode routes to the user's own server, which doesn't — those users
// get local diarization like everyone else.
export function shouldUseByokDiarize(
  _cfg: FileTranscriptionConfig,
  _diarizationEnabled: boolean
): boolean {
  // Aisha-only — no BYOK-native diarization path.
  return false;
}

// Transcribe and diarize in parallel, then merge speaker labels into the text.
// Shared by the single-file flow and the batch queue. `durationSeconds` (when the
// source knows it, e.g. URL downloads) beats inferring duration from segments.
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
          .diarizeAudioFile?.(filePath, {
            numSpeakers: diarization.numSpeakers ?? undefined,
          })
          .catch(() => null) ?? Promise.resolve(null))
      : Promise.resolve(null);

  const [result, diar] = await Promise.all([
    transcribeFile(filePath, cfg, byokDiarize),
    diarizePromise,
  ]);

  if (!result.success || !result.text || result.diarized) return result;
  if (!diar?.success || !diar.segments?.length) return result;

  try {
    const merged = await window.electronAPI.mergeSpeakerText?.(
      diar.segments,
      result.text,
      durationSeconds || 0
    );
    if (merged?.success && merged.text) return { ...result, text: merged.text };
  } catch {
    // Merge failure falls back to the plain transcript.
  }
  return result;
}
