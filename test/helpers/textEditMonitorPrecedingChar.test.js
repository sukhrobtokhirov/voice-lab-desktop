const test = require("node:test");
const assert = require("node:assert/strict");

const TextEditMonitor = require("../../src/helpers/textEditMonitor");

test("getPrecedingChar resolves to unknown for missing pid", async () => {
  const m = new TextEditMonitor();
  for (const pid of [null, undefined, 0]) {
    assert.deepEqual(await m.getPrecedingChar(pid), { state: "unknown" });
  }
});

test("getPrecedingChar returns unknown when the AX read fails or hangs", async () => {
  let invocation = null;
  const m = new TextEditMonitor({
    platform: "darwin",
    execFileImpl(command, args, options, callback) {
      invocation = { command, args, options };
      queueMicrotask(() => callback(new Error("AX read timed out"), ""));
    },
  });
  const result = await m.getPrecedingChar(99999999, 1500);

  assert.equal(result.state, "unknown");
  assert.equal(invocation.command, "osascript");
  assert.deepEqual(invocation.args.slice(0, 1), ["-e"]);
  assert.equal(invocation.options.timeout, 1500);
});

test("activateTargetPid resolves false when no target PID was captured", async () => {
  const m = new TextEditMonitor();
  m.lastTargetPid = null;
  assert.equal(await m.activateTargetPid(), false);
});

test("activateTargetPid resolves false for an unmapped PID", async () => {
  const delays = [];
  const m = new TextEditMonitor({
    platform: "darwin",
    sleepImpl: async (delayMs) => {
      delays.push(delayMs);
    },
  });
  m.lastTargetPid = 99999999;
  let activationPid = null;
  let frontmostReads = 0;
  m._activateApp = async (pid) => {
    activationPid = pid;
  };
  m._readFrontmostPid = async () => {
    frontmostReads += 1;
    return null;
  };

  const result = await m.activateTargetPid();

  assert.equal(result, false);
  assert.equal(activationPid, 99999999);
  assert.equal(frontmostReads, delays.length + 1);
  assert.ok(delays.length > 0);
  assert.ok(delays.every((delayMs) => delayMs > 0));
});

const darwinOnly = { skip: process.platform !== "darwin" };

test("startMonitoring stops immediately without a target PID", darwinOnly, () => {
  const m = new TextEditMonitor();
  m.startMonitoring("pasted text", 5000, { targetPid: null });
  assert.equal(m.currentOriginalText, null);
  assert.equal(m.process, null);
});

test("startMonitoring self-terminates when the target has no accessible focused element", darwinOnly, async () => {
  const m = new TextEditMonitor();
  // Auto-learn must degrade by giving up (NO_ELEMENT → stopMonitoring), never by
  // writing AX attributes like AXEnhancedUserInterface onto the target app —
  // that flag blurs the focused editor in some Chromium apps (see module comment).
  m.startMonitoring("pasted text", 4000, { targetPid: 99999999 });
  const deadline = Date.now() + 6000;
  while (m.currentOriginalText !== null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(m.currentOriginalText, null);
  assert.equal(m.process, null);
  assert.equal(m._pollInterval, null);
});
