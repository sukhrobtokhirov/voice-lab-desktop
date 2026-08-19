const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("desktop speech uses the authenticated Go usage and STT contracts", () => {
  const client = read("src/helpers/voiceLabApiClient.js");
  assert.match(client, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(client, /\/api\/v1\/account\/usage/);
  assert.match(client, /\/api\/v1\/stt/);
  assert.match(client, /\/api\/v1\/stt\/transcriptions\//);
  assert.doesNotMatch(client, /\/api\/v1\/desktop\/(wallet|dictation)/);
  assert.doesNotMatch(client, /X-Api-Key|AISHA_API_KEY/);
});

test("desktop release has no local speech runtime or whisper.cpp packaging", () => {
  const releaseSurface = [
    read("main.js"),
    read("preload.js"),
    read("package.json"),
    read("electron-builder.json"),
    read("resources/sidecar-manifest.json"),
    read(".github/workflows/build-and-notarize.yml"),
    read(".github/workflows/release-desktop.yml"),
  ].join("\n");

  assert.doesNotMatch(
    releaseSurface,
    /WhisperManager|ParakeetManager|whisper-cpp|whisper-server|download-whisper-cpp/
  );
  assert.equal(fs.existsSync(path.join(root, "scripts", "download-whisper-cpp.js")), false);
  assert.equal(fs.existsSync(path.join(root, "src", "helpers", "whisper.js")), false);
  assert.equal(fs.existsSync(path.join(root, "src", "helpers", "parakeet.js")), false);
  assert.doesNotMatch(
    read("src/models/modelRegistryData.json"),
    /whisper\.cpp|ggml-(?:tiny|base|small|medium|large)/
  );

  const diarizationDownloader = read("scripts/download-sherpa-onnx.js");
  assert.doesNotMatch(diarizationDownloader, /offline-websocket-server|online-websocket-server/);
  assert.match(diarizationDownloader, /offline-speaker-diarization/);
});

test("legacy transcription choices are migrated to VoiceLab Cloud", () => {
  const settingsStore = read("src/stores/settingsStore.ts");
  assert.match(settingsStore, /enforceVoiceLabCloudTranscription\(\)/);
  assert.match(settingsStore, /localStorage\.setItem\(key, "openwhispr"\)/);
  assert.match(settingsStore, /localStorage\.setItem\("useLocalWhisper", "false"\)/);
});

test("renderer preloads expose only the authenticated VoiceLab speech boundary", () => {
  const sources = [read("preload.js")];
  const generatedDir = path.join(root, "preloads");
  for (const name of fs.readdirSync(generatedDir).filter((file) => file.endsWith(".js"))) {
    sources.push(fs.readFileSync(path.join(generatedDir, name), "utf8"));
  }

  const preloadSurface = sources.join("\n");
  for (const capability of [
    "transcribeAudioFile",
    "providerTranscribe",
    "providerTranscribeFile",
    "transcribeLocalWhisper",
    "transcribeLocalParakeet",
    "assemblyAiStreamingStart",
    "deepgramStreamingStart",
    "cortiStreamingStart",
    "dictationRealtimeStart",
    "startDictationPreview",
    "sendDictationPreviewAudio",
  ]) {
    assert.doesNotMatch(preloadSurface, new RegExp(`\\b${capability}\\b`), capability);
  }

  assert.match(preloadSurface, /\bcloudTranscribe\b/);
  assert.match(preloadSurface, /\btranscribeAudioFileCloud\b/);
});

test("dictation, retry, meeting, and upload routes are pinned to VoiceLab cloud", () => {
  const audioManager = read("src/helpers/audioManager.js");
  const fileTranscription = read("src/services/fileTranscription.ts");
  const ipcHandlers = read("src/helpers/ipcHandlers.js");
  const providerIpc = read("src/helpers/ipc/registerProviderIpc.js");

  const processAudio = audioManager.slice(
    audioManager.indexOf("async processAudio("),
    audioManager.indexOf("async processWithLocalWhisper(")
  );
  assert.match(processAudio, /processWithOpenWhisprCloud\(audioBlob, metadata\)/);
  assert.doesNotMatch(processAudio, /processWithLocal|processWithOpenAIAPI|providerTranscribe/);
  assert.match(audioManager, /shouldUseStreaming\(_isSignedInOverride\)[\s\S]*?return false;/);

  assert.match(fileTranscription, /transcribeAudioFileCloud/);
  assert.doesNotMatch(fileTranscription, /providerTranscribe|transcribeAudioFile\s*\(/);

  assert.match(ipcHandlers, /DISABLED_LEGACY_SPEECH_CHANNELS/);
  assert.match(ipcHandlers, /meetingLocalMode = true/);
  assert.match(ipcHandlers, /meetingLocalProvider = "voicelab"/);
  assert.match(ipcHandlers, /meetingLocalModel = "voicelab-cloud"/);
  assert.doesNotMatch(
    ipcHandlers,
    /ipcMain\.on\("(?:dictation-realtime-send|dictation-preview-audio|assemblyai-streaming-send|deepgram-streaming-send|corti-streaming-send)"/
  );
  assert.doesNotMatch(providerIpc, /provider-transcribe(?:-file)?/);
});
