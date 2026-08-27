const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("system-audio capture can be disabled without stopping microphone dictation", () => {
  const settings = read("src/stores/settingsStore.ts");
  const meetingStore = read("src/stores/meetingRecordingStore.ts");
  const handlers = read("src/helpers/ipcHandlers.js");
  const preload = read("preload.js");
  const settingsPage = read("src/components/SettingsPage.tsx");

  assert.match(settings, /systemAudioCaptureEnabled/);
  assert.match(settings, /setSystemAudioCaptureEnabled/);
  assert.match(meetingStore, /systemAudioCaptureEnabled: state\.systemAudioCaptureEnabled !== false/);
  assert.match(meetingStore, /export async function disableMeetingSystemAudioCapture/);
  assert.match(meetingStore, /meetingTranscriptionSetSystemAudioEnabled\?\.\(false\)/);

  assert.match(handlers, /meeting-transcription-set-system-audio-enabled/);
  assert.match(handlers, /if \(source === "system" && !meetingSystemAudioCaptureEnabled\) return/);
  assert.match(handlers, /audioTapManager\.stop/);
  assert.match(handlers, /linuxPortalAudioManager\.stop/);
  assert.match(handlers, /windowsLoopbackAudioManager\.stop/);

  assert.match(preload, /meetingTranscriptionSetSystemAudioEnabled/);
  assert.match(settingsPage, /enabled=\{systemAudioCaptureEnabled\}/);
  assert.match(settingsPage, /disableMeetingSystemAudioCapture/);
});
