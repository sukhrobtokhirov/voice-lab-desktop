const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const childProcess = require("node:child_process");
const fs = require("node:fs");

const fakeClipboard = {
  text: "",
  html: "",
  rtf: "",
  image: null,
  formats: ["text/plain"],
  writes: [],
  availableFormats() {
    return this.formats;
  },
  readText() {
    return this.text;
  },
  writeText(text) {
    this.text = text;
    this.html = "";
    this.rtf = "";
    this.image = null;
    this.formats = ["text/plain"];
    this.writes.push(["writeText", text]);
  },
  readHTML() {
    return this.html;
  },
  readRTF() {
    return this.rtf;
  },
  write(payload) {
    this.text = payload.text || "";
    this.html = payload.html || "";
    this.rtf = payload.rtf || "";
    this.image = payload.image || null;
    this.formats = [];
    if (Object.hasOwn(payload, "text")) this.formats.push("text/plain");
    if (Object.hasOwn(payload, "html")) this.formats.push("text/html");
    if (Object.hasOwn(payload, "rtf")) this.formats.push("text/rtf");
    if (Object.hasOwn(payload, "image")) this.formats.push("image/png");
    this.writes.push(["write", payload]);
  },
  readImage() {
    return this.image || emptyImage;
  },
  writeImage(image) {
    this.text = "";
    this.html = "";
    this.rtf = "";
    this.image = image;
    this.formats = image && !image.isEmpty() ? ["image/png"] : [];
    this.writes.push(["writeImage", image]);
  },
};

const emptyImage = { isEmpty: () => true };
const nonEmptyImage = { isEmpty: () => false };

const clipboardModulePath = require.resolve("../../src/helpers/clipboard");

const originalLoad = Module._load;

test("macOS prompts once on an explicit paste and never attempts an untrusted paste", () => {
  const source = fs.readFileSync(clipboardModulePath, "utf8");
  const permissionCheck = source.indexOf("const hasPermissions");
  const nativePrompt = source.indexOf("isTrustedAccessibilityClient(true)", permissionCheck);
  const permissionError = source.indexOf('error.code = "PASTE_ACCESSIBILITY_REQUIRED"', nativePrompt);
  const pasteCall = source.indexOf("pasteResult = await this.pasteMacOS", permissionError);

  assert.ok(permissionCheck > -1 && nativePrompt > permissionCheck);
  assert.ok(permissionError > nativePrompt && pasteCall > permissionError);
  assert.match(source, /if \(!this\.accessibilityPastePromptAttempted\)/);
  assert.match(source.slice(permissionError, pasteCall), /throw error/);
});

function loadClipboardManager({ spawn } = {}) {
  delete require.cache[clipboardModulePath];

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "electron") {
      return {
        clipboard: fakeClipboard,
        systemPreferences: {
          isTrustedAccessibilityClient: () => true,
        },
      };
    }
    if (request === "child_process" && spawn) {
      return { ...childProcess, spawn };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require("../../src/helpers/clipboard");
  } finally {
    Module._load = originalLoad;
  }
}

const ClipboardManager = loadClipboardManager();

function createSuccessfulSpawn(calls) {
  return function successfulSpawn(command, args = []) {
    calls.push({ command, args });
    const pasteProcess = new EventEmitter();
    pasteProcess.stderr = new EventEmitter();
    pasteProcess.stdout = new EventEmitter();
    process.nextTick(() => pasteProcess.emit("close", 0));
    return pasteProcess;
  };
}

function createSpawnWithExitCodes(calls, exitCodes) {
  return function spawnWithExitCodes(command, args = []) {
    calls.push({ command, args });
    const pasteProcess = new EventEmitter();
    pasteProcess.stderr = new EventEmitter();
    pasteProcess.stdout = new EventEmitter();
    const code = exitCodes.shift();
    process.nextTick(() => pasteProcess.emit("close", code));
    return pasteProcess;
  };
}

function resetClipboard({
  text = "",
  html = "",
  rtf = "",
  image = null,
  formats = ["text/plain"],
} = {}) {
  fakeClipboard.text = text;
  fakeClipboard.html = html;
  fakeClipboard.rtf = rtf;
  fakeClipboard.image = image;
  fakeClipboard.formats = formats;
  fakeClipboard.writes = [];
}

test("restore preserves rich clipboard formats atomically", () => {
  resetClipboard({
    formats: ["text/html", "text/rtf", "text/plain", "image/png"],
    text: "plain before",
    html: "<b>html before</b>",
    rtf: "{\\rtf1 before}",
    image: nonEmptyImage,
  });
  const manager = new ClipboardManager();

  const snapshot = manager._saveClipboard();
  fakeClipboard.writeText("dictated text");
  manager._restoreClipboard(snapshot);

  assert.deepEqual([...fakeClipboard.availableFormats()].sort(), [
    "image/png",
    "text/html",
    "text/plain",
    "text/rtf",
  ]);
  assert.equal(fakeClipboard.text, "plain before");
  assert.equal(fakeClipboard.html, "<b>html before</b>");
  assert.equal(fakeClipboard.rtf, "{\\rtf1 before}");
  assert.equal(fakeClipboard.image, nonEmptyImage);
  assert.equal(fakeClipboard.writes.at(-1)[0], "write");
});

test("restore runs when clipboard still contains the pasted text", async () => {
  resetClipboard();
  fakeClipboard.text = "dictated text";
  const manager = new ClipboardManager();

  await manager._restoreClipboardAfterDelay(
    { type: "text", data: "previous clipboard" },
    { delayMs: 0, expectedText: "dictated text" }
  );

  assert.equal(fakeClipboard.text, "previous clipboard");
});

test("restore is skipped when another clipboard write wins the race", async () => {
  resetClipboard();
  fakeClipboard.text = "user copied something else";
  const manager = new ClipboardManager();

  await manager._restoreClipboardAfterDelay(
    { type: "text", data: "previous clipboard" },
    { delayMs: 0, expectedText: "dictated text" }
  );

  assert.equal(fakeClipboard.text, "user copied something else");
});

test("pasteText waits for prior clipboard restoration before starting the next paste", async () => {
  const manager = new ClipboardManager();
  const events = [];
  let releaseFirstRestore;

  manager._pasteText = async (text) => {
    events.push(`start:${text}`);
    events.push(`end:${text}`);
    if (text === "first") {
      return {
        restoreComplete: new Promise((resolve) => {
          releaseFirstRestore = resolve;
        }),
      };
    }
    return { restoreComplete: Promise.resolve() };
  };

  const firstResult = await manager.pasteText("first");
  assert.deepEqual(firstResult, { pasted: true, copied: true });
  assert.deepEqual(structuredClone(firstResult), firstResult);
  const secondPaste = manager.pasteText("second");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(events, ["start:first", "end:first"]);

  releaseFirstRestore();
  await secondPaste;
  assert.deepEqual(events, ["start:first", "end:first", "start:second", "end:second"]);
});

test("pasteMacOS sends one in-process CGEvent and restores the clipboard", async () => {
  const spawnCalls = [];
  const TestClipboardManager = loadClipboardManager({
    spawn: createSuccessfulSpawn(spawnCalls),
  });
  const manager = new TestClipboardManager();
  let pasteCalls = 0;
  manager.resolveMacOSPasteAddon = () => ({
    isTrusted: () => true,
    paste: () => {
      pasteCalls += 1;
      return true;
    },
  });
  const originalClipboard = { type: "text", data: "previous clipboard" };
  let restoreCall;

  manager._restoreClipboardAfterDelay = (original, options) => {
    restoreCall = { original, options };
    return Promise.resolve();
  };

  const result = await manager.pasteMacOS(originalClipboard, {
    expectedClipboardText: "dictated text",
    fromStreaming: true,
  });
  await result.restoreComplete;

  assert.equal(pasteCalls, 1);
  assert.equal(spawnCalls.length, 0);
  assert.equal(restoreCall.original, originalClipboard);
  assert.deepEqual(restoreCall.options, {
    delayMs: 450,
    expectedText: "dictated text",
  });
});

test("pasteMacOS falls back to one AppleScript paste when native helper is unavailable", async () => {
  const spawnCalls = [];
  const TestClipboardManager = loadClipboardManager({
    spawn: createSuccessfulSpawn(spawnCalls),
  });
  const manager = new TestClipboardManager();
  manager.resolveMacOSPasteAddon = () => null;
  manager.resolveFastPasteBinary = () => null;
  manager._restoreClipboardAfterDelay = () => Promise.resolve();

  const result = await manager.pasteMacOS(
    { type: "text", data: "previous clipboard" },
    { expectedClipboardText: "dictated text", fromStreaming: true }
  );
  await result.restoreComplete;

  assert.equal(result.pasted, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, "osascript");
  assert.deepEqual(spawnCalls[0].args, [
    "-e",
    'tell application "System Events" to key code 9 using command down',
  ]);
});

test("native helper trust denial safely falls back to the captured target PID", async () => {
  const spawnCalls = [];
  const TestClipboardManager = loadClipboardManager({
    spawn: createSpawnWithExitCodes(spawnCalls, [2, 0]),
  });
  const manager = new TestClipboardManager();
  manager.resolveMacOSPasteAddon = () => null;
  manager.resolveFastPasteBinary = () => "/bundled/macos-fast-paste";
  manager._restoreClipboardAfterDelay = () => Promise.resolve();

  const result = await manager.pasteMacOS(
    { type: "text", data: "previous clipboard" },
    {
      expectedClipboardText: "dictated text",
      fromStreaming: true,
      targetPid: 4242,
    }
  );
  await result.restoreComplete;

  assert.equal(result.pasted, true);
  assert.equal(spawnCalls.length, 2);
  assert.deepEqual(spawnCalls[0], {
    command: "/bundled/macos-fast-paste",
    args: [],
  });
  assert.equal(spawnCalls[1].command, "osascript");
  assert.match(spawnCalls[1].args[1], /unix id is 4242/);
  assert.match(spawnCalls[1].args[1], /tell targetProcess to keystroke "v" using command down/);
});

test("pasteMacOSWithOsascript fallback uses the short macOS restore delay", async () => {
  const spawnCalls = [];
  const TestClipboardManager = loadClipboardManager({
    spawn: createSuccessfulSpawn(spawnCalls),
  });
  const manager = new TestClipboardManager();
  const originalClipboard = { type: "text", data: "previous clipboard" };
  let restoreCall;

  manager._restoreClipboardAfterDelay = (original, options) => {
    restoreCall = { original, options };
    return Promise.resolve();
  };

  const result = await manager.pasteMacOSWithOsascript(originalClipboard, {
    expectedClipboardText: "dictated text",
  });
  await result.restoreComplete;

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, "osascript");
  assert.deepEqual(spawnCalls[0].args, [
    "-e",
    'tell application "System Events" to key code 9 using command down',
  ]);
  assert.equal(restoreCall.original, originalClipboard);
  assert.deepEqual(restoreCall.options, {
    delayMs: 450,
    expectedText: "dictated text",
  });
});
