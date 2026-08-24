const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("transcription copy paths prefer Electron's clipboard bridge", () => {
  const clipboard = read("src/utils/writeClipboard.ts");
  const controlPanel = read("src/components/ControlPanel.tsx");
  const recording = read("src/hooks/useAudioRecording.js");
  const preview = read("src/components/TranscriptionPreviewOverlay.tsx");
  const transcriptionItem = read("src/components/ui/TranscriptionItem.tsx");

  assert.match(clipboard, /window\.electronAPI\?\.writeClipboard/);
  assert.match(clipboard, /navigator\.clipboard\.writeText/);

  for (const source of [controlPanel, recording, preview]) {
    assert.match(source, /writeTextToClipboard/);
  }

  assert.doesNotMatch(controlPanel, /controlPanel\.history\.copiedTitle/);
  assert.match(transcriptionItem, /copiedTarget === "text" \? <Check/);
});
