const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("the start cue completes before microphone recording starts", () => {
  const source = read("src/hooks/useAudioRecording.js");
  const startFlow = source.slice(
    source.indexOf("const performStartRecording"),
    source.indexOf("const performStopRecording")
  );

  assert.ok(startFlow.indexOf("await playStartCue();") >= 0);
  assert.ok(
    startFlow.indexOf("await playStartCue();") <
      startFlow.indexOf("audioManagerRef.current.startRecording()")
  );
});

test("the start cue promise waits through the audible tone", () => {
  const source = read("src/utils/dictationCues.js");

  assert.match(source, /waitForCompletion: true/);
  assert.match(source, /await new Promise\(\(resolve\) => setTimeout/);
});

test("all locally detected non-speech is rejected before cloud upload", () => {
  const source = read("src/helpers/audioManager.js");
  const processAudio = source.slice(
    source.indexOf("async processAudio(audioBlob"),
    source.indexOf("async processWithLocalWhisper")
  );

  assert.match(processAudio, /if \(speechGateDecision\.skip\)/);
  assert.ok(
    processAudio.indexOf("if (speechGateDecision.skip)") <
      processAudio.indexOf("this.processWithOpenWhisprCloud")
  );
});
