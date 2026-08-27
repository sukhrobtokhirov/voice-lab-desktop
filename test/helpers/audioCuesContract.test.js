const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("bundled sounds are assigned to recording, notifications, and errors", () => {
  const cues = read("src/utils/dictationCues.js");
  const toasts = read("src/components/ui/Toast.tsx");

  for (const file of ["voice.wav", "notification.wav", "error.wav"]) {
    assert.equal(fs.existsSync(path.join(root, "src/assets/audios", file)), true);
  }

  assert.match(cues, /playStartCue = \(\) => playAudioCue\("voice"/);
  assert.match(cues, /playStopCue = \(\) => playAudioCue\("voice"/);
  assert.match(toasts, /const isError = props\.variant === "destructive"/);
  assert.match(toasts, /if \(!isError && !getSettings\(\)\.notificationsEnabled\) return id/);
  assert.match(toasts, /isError \? playErrorCue\(\) : playNotificationCue\(\)/);
  assert.match(cues, /getSettings\(\)\.audioCuesEnabled/);
});
