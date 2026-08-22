const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
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

test("desktop STT recognizes and preserves every documented container", () => {
  const { detectAudioContainer, prepareDesktopSttAudio } = loadFfmpegUtils();
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
    const prepared = prepareDesktopSttAudio(buffer);
    assert.equal(prepared.contentType, contentType);
    assert.equal(prepared.fileName, fileName);
    assert.equal(prepared.buffer, buffer);
  }
});

test("desktop STT uses MIME only as a hint and never rewrites unknown bytes", () => {
  const { prepareDesktopSttAudio } = loadFfmpegUtils();
  const original = Buffer.from("opaque server-sniffed recording");
  const prepared = prepareDesktopSttAudio(original, { contentType: "audio/webm; codecs=opus" });

  assert.equal(prepared.buffer, original);
  assert.equal(prepared.contentType, "audio/webm");
  assert.equal(prepared.fileName, "audio.webm");
});

test("desktop dictation sends original audio and never calls website cleanup", () => {
  const root = path.resolve(__dirname, "../..");
  const ipc = fs.readFileSync(path.join(root, "src/helpers/ipcHandlers.js"), "utf8");
  const audioManager = fs.readFileSync(path.join(root, "src/helpers/audioManager.js"), "utf8");
  const cloudMethodStart = audioManager.indexOf("async processWithVoiceLabCloud(");
  const cloudMethodEnd = audioManager.indexOf("\n  getCustomDictionaryArray()", cloudMethodStart);

  assert.notEqual(cloudMethodStart, -1);
  assert.notEqual(cloudMethodEnd, -1);
  assert.match(ipc, /prepareDesktopSttAudio\(boundedAudio/);
  assert.doesNotMatch(ipc, /prepareCloudSttAudio\(boundedAudio/);
  assert.doesNotMatch(
    audioManager.slice(cloudMethodStart, cloudMethodEnd),
    /electronAPI\.cloudReason\s*\(/
  );
});

test("desktop recording has no client-invented five-minute request cap", () => {
  const root = path.resolve(__dirname, "../..");
  const client = fs.readFileSync(path.join(root, "src/helpers/voiceLabApiClient.js"), "utf8");
  const windows = fs.readFileSync(path.join(root, "src/helpers/windowManager.js"), "utf8");

  assert.doesNotMatch(client, /MAX_AUDIO_DURATION_MS|maxDurationSeconds\s*=\s*Math\.min/);
  assert.doesNotMatch(windows, /MAX_PUSH_DURATION_MS|5 minutes max recording/);
});
