const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const Module = require("node:module");

const windowSecurityPath = require.resolve("../../src/helpers/windowSecurity");
const devServerManagerPath = require.resolve("../../src/helpers/devServerManager");
const originalLoad = Module._load;
const appPath = path.join(__dirname, "..", "..");

function withWindowSecurity(callback) {
  delete require.cache[windowSecurityPath];
  delete require.cache[devServerManagerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: { getAppPath: () => appPath },
        shell: { openExternal: async () => {} },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return callback(require("../../src/helpers/windowSecurity"));
  } finally {
    Module._load = originalLoad;
  }
}

test("renderer navigation is exact and never trusts remote web content", () => {
  withWindowSecurity(({ isAllowedRendererUrl }) => {
    const appIndex = path.join(appPath, "src", "dist", "index.html");
    assert.equal(isAllowedRendererUrl(pathToFileURL(appIndex).href), true);
    assert.equal(isAllowedRendererUrl(`${pathToFileURL(appIndex).href}?window=control-panel`), true);
    assert.equal(isAllowedRendererUrl("https://voicelab.uz/app"), false);
    assert.equal(isAllowedRendererUrl("file:///tmp/index.html"), false);
  });
});

test("development navigation allows only the exact Vite origin", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    withWindowSecurity(({ isAllowedRendererUrl }) => {
      assert.equal(isAllowedRendererUrl("http://localhost:5183/"), true);
      assert.equal(isAllowedRendererUrl("http://localhost:5183.evil.test/"), false);
      assert.equal(isAllowedRendererUrl("http://127.0.0.1:5183/"), false);
      assert.equal(isAllowedRendererUrl("http://localhost:5184/"), false);
    });
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("external navigation allows safe https and mailto only", () => {
  withWindowSecurity(({ isAllowedExternalUrl }) => {
    assert.equal(isAllowedExternalUrl("https://voicelab.uz/app/settings"), true);
    assert.equal(isAllowedExternalUrl("mailto:support@voicelab.uz"), true);
    assert.equal(isAllowedExternalUrl("http://voicelab.uz"), false);
    assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
    assert.equal(isAllowedExternalUrl("https://user:pass@voicelab.uz"), false);
  });
});
