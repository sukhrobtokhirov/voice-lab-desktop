const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

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
  const { detectAudioContainer, prepareCloudSttAudio } = loadFfmpegUtils();
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
    const prepared = await prepareCloudSttAudio(buffer);
    assert.equal(prepared.converted, false);
    assert.equal(prepared.contentType, contentType);
    assert.equal(prepared.fileName, fileName);
    assert.equal(prepared.buffer, buffer);
  }
});
