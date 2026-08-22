const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("does not save cloud API failures as workspace transcriptions", () => {
  const source = read("src/helpers/audioManager.js");
  const processAudio = source.slice(
    source.indexOf("async processAudio("),
    source.indexOf("async processWithLocalWhisper(")
  );

  assert.match(processAudio, /API failures are transient request state/);
  assert.doesNotMatch(processAudio, /saveFailedTranscription/);
  assert.match(processAudio, /this\.lastRetryMetadata = metadata/);
});

test("filters old authentication failures from initial and live history", () => {
  const database = read("src/helpers/database.js");
  const store = read("src/stores/transcriptionStore.ts");

  assert.match(
    database,
    /status = 'failed' AND error_code IN \('AUTH_EXPIRED', 'AUTH_REQUIRED'\)/
  );
  assert.match(
    store,
    /item\.error_code === "AUTH_EXPIRED" \|\| item\.error_code === "AUTH_REQUIRED"/
  );
});
