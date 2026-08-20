const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { once } = require("events");

test("debug logs are private and process diagnostics redact arguments and output", async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "vlab-log-test-"));
  const modulePath = require.resolve("../../src/helpers/debugLogger");
  const originalLoad = Module._load;
  const previousLevel = process.env.VOICELAB_LOG_LEVEL;
  const entries = [];
  let logger;

  process.env.VOICELAB_LOG_LEVEL = "debug";
  delete require.cache[modulePath];
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          isReady: () => true,
          getPath: () => userData,
          getAppPath: () => "/application",
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    logger = require(modulePath);
    logger.ensureFileLogging();
    if (logger.logStream.pending) await once(logger.logStream, "open");

    const logsDir = path.dirname(logger.getLogPath());
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(logsDir).mode & 0o777, 0o700);
      assert.equal(fs.statSync(logger.getLogPath()).mode & 0o777, 0o600);
    }

    logger.debug = (message, metadata) => entries.push({ message, metadata });
    logger.logProcessStart("/usr/bin/ffmpeg", ["--token", "super-secret"], {
      cwd: "/private/customer/path",
    });
    logger.logProcessOutput("ffmpeg", "stderr", "super-secret output");

    const serialized = JSON.stringify(entries);
    assert.doesNotMatch(serialized, /super-secret|customer\/path/);
    assert.match(serialized, /"argCount":2/);
    assert.match(serialized, /"byteLength":19/);
  } finally {
    Module._load = originalLoad;
    if (previousLevel === undefined) delete process.env.VOICELAB_LOG_LEVEL;
    else process.env.VOICELAB_LOG_LEVEL = previousLevel;
    if (logger?.logStream) {
      const stream = logger.logStream;
      logger.close();
      if (!stream.closed) await once(stream, "close");
    }
    delete require.cache[modulePath];
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
