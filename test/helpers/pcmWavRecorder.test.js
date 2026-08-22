const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const load = () => import("../../src/helpers/pcmWavRecorder.js");
const { validatePcm16Wav } = require("../../src/helpers/wavValidator");

test("PCM encoder produces a strict playable 16 kHz mono WAV", async () => {
  const { encodePcm16Wav, parsePcm16Wav } = await load();
  const samples = new Int16Array([0, 32767, -32768, 1024, -1024]);
  const wav = encodePcm16Wav([samples], 16000, 1);

  assert.equal(Buffer.from(wav).toString("ascii", 0, 4), "RIFF");
  assert.equal(Buffer.from(wav).toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.byteLength, 44 + samples.byteLength);
  const parsed = parsePcm16Wav(wav);
  assert.equal(parsed.audioFormat, 1);
  assert.equal(parsed.sampleRate, 16000);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.bitsPerSample, 16);
  assert.deepEqual([...parsed.samples], [...samples]);
  const validated = validatePcm16Wav(Buffer.from(wav));
  assert.equal(validated.dataBytes, samples.byteLength);
  assert.equal(validated.durationMs, 0);
});

test("PCM WAV segments merge without introducing a compressed container", async () => {
  const { encodePcm16Wav, mergePcm16WavBuffers, parsePcm16Wav } = await load();
  const first = encodePcm16Wav([new Int16Array([1, 2, 3])]);
  const second = encodePcm16Wav([new Int16Array([4, 5])]);
  const merged = mergePcm16WavBuffers([first, second]);

  assert.deepEqual([...parsePcm16Wav(merged).samples], [1, 2, 3, 4, 5]);
  assert.equal(Buffer.from(merged).includes(Buffer.from("webm")), false);
});

test("PCM fallback resamples a native 48 kHz capture to the canonical 16 kHz rate", async () => {
  const { resamplePcm16 } = await load();
  const source = new Int16Array(48000);
  source.fill(1234);
  const resampled = resamplePcm16([source], 48000, 16000);

  assert.equal(resampled.length, 16000);
  assert.equal(resampled[0], 1234);
  assert.equal(resampled[resampled.length - 1], 1234);
});

test("main-process WAV boundary rejects compressed or malformed input", async () => {
  const { encodePcm16Wav } = await load();
  assert.throws(() => validatePcm16Wav(Buffer.from("webm")), /WAV file is truncated/);

  const wrongRate = Buffer.from(encodePcm16Wav([new Int16Array([1, 2])], 48000, 1));
  assert.throws(() => validatePcm16Wav(wrongRate), /16 kHz mono 16-bit/);
});

test("dictation capture and preload use the dedicated WAV boundary without MediaRecorder", () => {
  const root = path.resolve(__dirname, "../..");
  const manager = fs.readFileSync(path.join(root, "src/helpers/audioManager.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
  const ipc = fs.readFileSync(path.join(root, "src/helpers/ipcHandlers.js"), "utf8");

  assert.doesNotMatch(manager, /new MediaRecorder\s*\(/);
  assert.match(manager, /new PcmWavRecorder\s*\(/);
  assert.match(preload, /saveWavRecording:/);
  assert.match(ipc, /save-wav-recording/);
  assert.match(ipc, /validatePcm16Wav/);
});
