import { isEmptyRecording } from "./recordingGuard.js";

// Decide whether a finished PCM capture carries real samples before it reaches
// storage or the transcription backend. A fast tap can contain only a WAV header.
export function evaluateFinishedRecording({ blobSize, receivedAudioData } = {}) {
  if (!receivedAudioData) {
    return { usable: false, reason: "no-audio-data" };
  }
  if (isEmptyRecording(blobSize)) {
    return { usable: false, reason: "empty-container" };
  }
  return { usable: true, reason: null };
}
