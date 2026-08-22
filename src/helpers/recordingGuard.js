// A PCM WAV created by an accidental double-tap may contain only its 44-byte
// header and a few samples. Real speech, even a single short word, produces far
// more. We gate on size, not wall-clock duration, so a genuinely short utterance
// is not discarded merely because it was brief. See issue #864.
export const MIN_AUDIO_BYTES = 256;

export function isEmptyRecording(blobSize) {
  const size = typeof blobSize === "number" && Number.isFinite(blobSize) ? blobSize : 0;
  return size < MIN_AUDIO_BYTES;
}
