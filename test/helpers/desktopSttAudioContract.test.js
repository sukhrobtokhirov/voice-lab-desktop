const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

function loadFfmpegUtils() {
  const modulePath = require.resolve("../../src/helpers/ffmpegUtils");
  const originalLoad = Module._load;
  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === "electron") return { app: { isReady: () => false } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[modulePath];
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function signatureBuffer(hex, asciiWrites = []) {
  const buffer = Buffer.alloc(32);
  if (hex) Buffer.from(hex, "hex").copy(buffer);
  for (const [value, offset] of asciiWrites) buffer.write(value, offset, "ascii");
  return buffer;
}

test("desktop STT recognizes every documented container and canonical MIME", async () => {
  const { detectAudioContainer, prepareCloudSttAudio, requiresCloudSttConversion } =
    loadFfmpegUtils();
  const cases = [
    [
      "wav",
      "audio/wav",
      "audio.wav",
      signatureBuffer(null, [
        ["RIFF", 0],
        ["WAVE", 8],
      ]),
    ],
    ["mp3", "audio/mpeg", "audio.mp3", signatureBuffer(null, [["ID3", 0]])],
    [
      "m4a",
      "audio/mp4",
      "audio.m4a",
      signatureBuffer(null, [
        ["ftyp", 4],
        ["M4A ", 8],
      ]),
    ],
    ["aac", "audio/aac", "audio.aac", signatureBuffer("fff1")],
    ["ogg", "audio/ogg", "audio.ogg", signatureBuffer(null, [["OggS", 0]])],
    ["webm", "audio/webm", "audio.webm", signatureBuffer("1a45dfa3")],
    ["flac", "audio/flac", "audio.flac", signatureBuffer(null, [["fLaC", 0]])],
    [
      "aiff",
      "audio/aiff",
      "audio.aiff",
      signatureBuffer(null, [
        ["FORM", 0],
        ["AIFF", 8],
      ]),
    ],
    ["amr", "audio/amr", "audio.amr", signatureBuffer(null, [["#!AMR\n", 0]])],
    [
      "3gp",
      "audio/3gpp",
      "audio.3gp",
      signatureBuffer(null, [
        ["ftyp", 4],
        ["3gp4", 8],
      ]),
    ],
    ["caf", "audio/caf", "audio.caf", signatureBuffer(null, [["caff", 0]])],
    ["wma", "audio/x-ms-wma", "audio.wma", signatureBuffer("3026b2758e66cf11a6d900aa0062ce6c")],
  ];

  for (const [container, contentType, fileName, buffer] of cases) {
    assert.equal(detectAudioContainer(buffer), container);
    if (container === "webm") {
      assert.equal(requiresCloudSttConversion(container), true);
      continue;
    }
    const prepared = await prepareCloudSttAudio(buffer);
    assert.equal(prepared.converted, false);
    assert.equal(prepared.contentType, contentType);
    assert.equal(prepared.fileName, fileName);
    assert.equal(prepared.buffer, buffer);
  }

  assert.equal(requiresCloudSttConversion("wav"), false);
  assert.equal(requiresCloudSttConversion("m4a"), false);
  assert.equal(requiresCloudSttConversion(null), true);
});

test("desktop STT canonicalizes Chromium WebM recordings to 16 kHz mono PCM WAV", async () => {
  const { getFFmpegPath, parseWavFormat, prepareCloudSttAudio } = loadFfmpegUtils();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-webm-contract-"));
  const webmPath = path.join(tempDir, "recording.webm");

  try {
    execFileSync(
      getFFmpegPath(),
      [
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=0.75",
        "-c:a",
        "libopus",
        "-y",
        webmPath,
      ],
      { stdio: "ignore" }
    );

    const prepared = await prepareCloudSttAudio(fs.readFileSync(webmPath));
    assert.equal(prepared.converted, true);
    assert.equal(prepared.contentType, "audio/wav");
    assert.equal(prepared.fileName, "audio.wav");
    assert.deepEqual(parseWavFormat(prepared.buffer), {
      channels: 1,
      sampleRate: 16000,
      bitsPerSample: 16,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("desktop dictation derives duration from validated WAV and never calls website cleanup", () => {
  const root = path.resolve(__dirname, "../..");
  const ipc = fs.readFileSync(path.join(root, "src/helpers/ipcHandlers.js"), "utf8");
  const audioManager = fs.readFileSync(path.join(root, "src/helpers/audioManager.js"), "utf8");
  const cloudMethodStart = audioManager.indexOf("async processWithVoiceLabCloud(");
  const cloudMethodEnd = audioManager.indexOf("\n  getCustomDictionaryArray()", cloudMethodStart);

  assert.notEqual(cloudMethodStart, -1);
  assert.notEqual(cloudMethodEnd, -1);
  assert.match(ipc, /const durationMs = validatePcm16Wav\(audioData\)\.durationMs/);
  assert.doesNotMatch(
    audioManager.slice(cloudMethodStart, cloudMethodEnd),
    /electronAPI\.cloudReason\s*\(/
  );
});
