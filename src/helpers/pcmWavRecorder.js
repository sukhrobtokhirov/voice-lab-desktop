const TARGET_SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const WAV_HEADER_BYTES = 44;

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function exactArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new TypeError("PCM data must be an ArrayBuffer or typed array");
}

export function encodePcm16Wav(chunks, sampleRate = TARGET_SAMPLE_RATE, channels = CHANNELS) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError("WAV sample rate is invalid");
  }
  if (channels !== 1) throw new RangeError("VoiceLab recordings must be mono");

  const normalized = chunks.map((chunk) =>
    chunk instanceof Int16Array ? chunk : new Int16Array(exactArrayBuffer(chunk))
  );
  const sampleCount = normalized.reduce((total, chunk) => total + chunk.length, 0);
  const dataBytes = sampleCount * Int16Array.BYTES_PER_ELEMENT;
  const output = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(output);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(32, channels * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let byteOffset = WAV_HEADER_BYTES;
  for (const chunk of normalized) {
    for (let index = 0; index < chunk.length; index += 1) {
      view.setInt16(byteOffset, chunk[index], true);
      byteOffset += 2;
    }
  }
  return output;
}

export function parsePcm16Wav(value) {
  const buffer = exactArrayBuffer(value);
  if (buffer.byteLength < WAV_HEADER_BYTES) throw new Error("WAV file is truncated");
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const ascii = (offset, length) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new Error("WAV signature is invalid");
  }

  let format = null;
  let dataOffset = -1;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= buffer.byteLength; ) {
    const chunkId = ascii(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const contents = offset + 8;
    if (contents + chunkSize > buffer.byteLength) throw new Error("WAV chunk is truncated");
    if (chunkId === "fmt " && chunkSize >= 16) {
      format = {
        audioFormat: view.getUint16(contents, true),
        channels: view.getUint16(contents + 2, true),
        sampleRate: view.getUint32(contents + 4, true),
        bitsPerSample: view.getUint16(contents + 14, true),
      };
    } else if (chunkId === "data") {
      dataOffset = contents;
      dataBytes = chunkSize;
      break;
    }
    offset = contents + chunkSize + (chunkSize % 2);
  }

  if (
    !format ||
    format.audioFormat !== 1 ||
    format.channels !== CHANNELS ||
    format.bitsPerSample !== BITS_PER_SAMPLE ||
    dataOffset < 0 ||
    dataBytes % 2 !== 0
  ) {
    throw new Error("WAV must contain mono 16-bit linear PCM audio");
  }
  const samplesBuffer = buffer.slice(dataOffset, dataOffset + dataBytes);
  return { ...format, samples: new Int16Array(samplesBuffer) };
}

export function mergePcm16WavBuffers(values) {
  const parsed = values.map(parsePcm16Wav);
  if (parsed.length === 0) return encodePcm16Wav([], TARGET_SAMPLE_RATE, CHANNELS);
  const sampleRate = parsed[0].sampleRate;
  if (parsed.some((entry) => entry.sampleRate !== sampleRate)) {
    throw new Error("WAV segments use different sample rates");
  }
  return encodePcm16Wav(
    parsed.map((entry) => entry.samples),
    sampleRate,
    CHANNELS
  );
}

function floatToPcm16(input) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function resamplePcm16(chunks, sourceRate, targetRate = TARGET_SAMPLE_RATE) {
  const sourceLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const source = new Int16Array(sourceLength);
  let sourceOffset = 0;
  for (const chunk of chunks) {
    source.set(chunk, sourceOffset);
    sourceOffset += chunk.length;
  }
  if (sourceRate === targetRate || source.length === 0) return source;
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new RangeError("PCM resampling rate is invalid");
  }

  const targetLength = Math.max(1, Math.round((source.length * targetRate) / sourceRate));
  const output = new Int16Array(targetLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < targetLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(source.length - 1, Math.floor(position));
    const right = Math.min(source.length - 1, left + 1);
    const fraction = position - left;
    output[index] = Math.round(source[left] + (source[right] - source[left]) * fraction);
  }
  return output;
}

const workletSource = `
const CHUNK_SAMPLES = 2048;
class VoiceLabPcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(CHUNK_SAMPLES);
    this.offset = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data !== "stop" || this.stopped) return;
      if (this.offset > 0) this.flush(this.offset);
      this.stopped = true;
      this.port.postMessage("flushed");
    };
  }
  flush(length = this.buffer.length) {
    const chunk = length === this.buffer.length ? this.buffer : this.buffer.slice(0, length);
    this.port.postMessage(chunk.buffer, [chunk.buffer]);
    this.buffer = new Int16Array(CHUNK_SAMPLES);
    this.offset = 0;
  }
  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index]));
      this.buffer[this.offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.offset === this.buffer.length) this.flush();
    }
    return true;
  }
}
registerProcessor("voicelab-pcm16-capture", VoiceLabPcm16Capture);
`;

export class PcmWavRecorder {
  constructor({ sampleRate = TARGET_SAMPLE_RATE, onAudioData = null } = {}) {
    this.targetSampleRate = sampleRate;
    this.onAudioData = onAudioData;
    this.state = "inactive";
    this.chunks = [];
    this.sampleRate = sampleRate;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.silentSink = null;
    this.stopPromise = null;
    this.flushResolve = null;
  }

  async start(stream) {
    if (this.state !== "inactive") throw new Error("PCM recorder has already started");
    this.context = new AudioContext({ sampleRate: this.targetSampleRate });
    this.stream = stream;
    if (this.context.state === "suspended") await this.context.resume();
    this.sampleRate = this.context.sampleRate;
    this.source = this.context.createMediaStreamSource(stream);
    this.silentSink = this.context.createGain();
    this.silentSink.gain.value = 0;
    this.silentSink.connect(this.context.destination);

    let workletReady = false;
    if (this.context.audioWorklet && typeof AudioWorkletNode === "function") {
      const moduleUrl = URL.createObjectURL(
        new Blob([workletSource], { type: "application/javascript" })
      );
      try {
        await this.context.audioWorklet.addModule(moduleUrl);
        this.processor = new AudioWorkletNode(this.context, "voicelab-pcm16-capture", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        this.processor.port.onmessage = (event) => {
          if (event.data === "flushed") {
            this.flushResolve?.();
            return;
          }
          if (event.data instanceof ArrayBuffer) this._appendChunk(new Int16Array(event.data));
        };
        workletReady = true;
      } catch {
        // Some Electron/CSP combinations reject Blob-backed worklet modules.
        // ScriptProcessor remains a Web Audio PCM fallback and never uses MediaRecorder.
        this.processor = null;
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
    }
    if (!workletReady) {
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        this._appendChunk(floatToPcm16(input));
        event.outputBuffer.getChannelData(0).fill(0);
      };
    }

    this.source.connect(this.processor);
    this.processor.connect(this.silentSink);
    this.state = "recording";
    return this;
  }

  _appendChunk(chunk) {
    if (!chunk.length) return;
    this.chunks.push(chunk);
    this.onAudioData?.(chunk.length);
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this._stop();
    return this.stopPromise;
  }

  async _stop() {
    if (this.state === "inactive") {
      return encodePcm16Wav([], this.sampleRate, CHANNELS);
    }
    this.state = "stopping";
    if (this.processor?.port) {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          this.flushResolve = null;
          resolve();
        };
        this.flushResolve = finish;
        this.processor.port.postMessage("stop");
        window.setTimeout(finish, 500);
      });
    } else if (this.processor) {
      this.processor.onaudioprocess = null;
    }

    this.source?.disconnect();
    this.processor?.disconnect();
    this.silentSink?.disconnect();
    await this.context?.close().catch(() => {});
    this.state = "stopped";
    const pcm = resamplePcm16(this.chunks, this.sampleRate, this.targetSampleRate);
    return encodePcm16Wav([pcm], this.targetSampleRate, CHANNELS);
  }
}

export const PCM_WAV_RECORDING_FORMAT = Object.freeze({
  mimeType: "audio/wav",
  sampleRate: TARGET_SAMPLE_RATE,
  channels: CHANNELS,
  bitsPerSample: BITS_PER_SAMPLE,
});
