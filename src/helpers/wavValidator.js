const PCM_FORMAT = 1;
const EXPECTED_CHANNELS = 1;
const EXPECTED_SAMPLE_RATE = 16000;
const EXPECTED_BITS_PER_SAMPLE = 16;
const MIN_WAV_BYTES = 44;

function validatePcm16Wav(value, { allowEmpty = false } = {}) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (buffer.length < MIN_WAV_BYTES) throw new Error("WAV file is truncated");
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("WAV signature is invalid");
  }
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) {
    throw new Error("WAV RIFF length is invalid");
  }

  let format = null;
  let dataBytes = null;
  for (let offset = 12; offset + 8 <= buffer.length; ) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const contents = offset + 8;
    if (contents + chunkSize > buffer.length) throw new Error("WAV chunk is truncated");
    if (chunkId === "fmt " && chunkSize >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(contents),
        channels: buffer.readUInt16LE(contents + 2),
        sampleRate: buffer.readUInt32LE(contents + 4),
        byteRate: buffer.readUInt32LE(contents + 8),
        blockAlign: buffer.readUInt16LE(contents + 12),
        bitsPerSample: buffer.readUInt16LE(contents + 14),
      };
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }
    offset = contents + chunkSize + (chunkSize % 2);
  }

  const expectedBlockAlign = EXPECTED_CHANNELS * (EXPECTED_BITS_PER_SAMPLE / 8);
  if (
    !format ||
    format.audioFormat !== PCM_FORMAT ||
    format.channels !== EXPECTED_CHANNELS ||
    format.sampleRate !== EXPECTED_SAMPLE_RATE ||
    format.bitsPerSample !== EXPECTED_BITS_PER_SAMPLE ||
    format.blockAlign !== expectedBlockAlign ||
    format.byteRate !== EXPECTED_SAMPLE_RATE * expectedBlockAlign
  ) {
    throw new Error("WAV must be 16 kHz mono 16-bit linear PCM");
  }
  if (dataBytes == null || dataBytes % expectedBlockAlign !== 0 || (!allowEmpty && dataBytes === 0)) {
    throw new Error("WAV PCM data is invalid");
  }

  return {
    buffer,
    sampleRate: format.sampleRate,
    channels: format.channels,
    bitsPerSample: format.bitsPerSample,
    dataBytes,
    durationMs: Math.round((dataBytes / format.byteRate) * 1000),
  };
}

module.exports = { validatePcm16Wav };
