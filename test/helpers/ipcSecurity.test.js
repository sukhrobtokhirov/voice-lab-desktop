const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ipcSecurityPath = require.resolve("../../src/helpers/ipcSecurity");
const windowSecurityPath = require.resolve("../../src/helpers/windowSecurity");
const devServerManagerPath = require.resolve("../../src/helpers/devServerManager");
const originalLoad = Module._load;
const appPath = path.join(__dirname, "..", "..");

function withSecurity(callback) {
  delete require.cache[ipcSecurityPath];
  delete require.cache[windowSecurityPath];
  delete require.cache[devServerManagerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: { getAppPath: () => appPath },
        BrowserWindow: {
          fromWebContents: (sender) => sender._window || null,
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return callback(require("../../src/helpers/ipcSecurity"));
  } finally {
    Module._load = originalLoad;
  }
}

function fixture() {
  const mainWindow = { name: "main" };
  const controlPanelWindow = { name: "control" };
  const frame = {
    url: pathToFileURL(path.join(appPath, "src", "dist", "index.html")).href,
  };
  const sender = {
    _window: mainWindow,
    isDestroyed: () => false,
    mainFrame: frame,
  };
  return {
    manager: { mainWindow, controlPanelWindow },
    sender,
    event: { sender, senderFrame: frame },
  };
}

test("accepts only registered top-level application frames", () => {
  withSecurity(({ assertTrustedIpcSender }) => {
    const { event, manager } = fixture();
    assert.doesNotThrow(() => assertTrustedIpcSender(event, "paste-text", manager));

    assert.throws(
      () => assertTrustedIpcSender({ ...event, senderFrame: { url: event.senderFrame.url } }, "paste-text", manager),
      { code: "IPC_SUBFRAME_FORBIDDEN" }
    );
    event.senderFrame.url = "https://evil.test/";
    assert.throws(
      () => assertTrustedIpcSender(event, "paste-text", manager),
      { code: "IPC_ORIGIN_FORBIDDEN" }
    );
  });
});

test("groups generic credential writes and auth into control-panel capabilities", () => {
  withSecurity(({ assertTrustedIpcSender }) => {
    const { event, manager, sender } = fixture();
    assert.throws(
      () => assertTrustedIpcSender(event, "provider-save-credential", manager),
      { code: "IPC_CAPABILITY_FORBIDDEN" }
    );
    sender._window = manager.controlPanelWindow;
    assert.doesNotThrow(() => assertTrustedIpcSender(event, "provider-save-credential", manager));
    assert.doesNotThrow(() => assertTrustedIpcSender(event, "auth-start-browser", manager));
  });
});

test("raw credential reads are unavailable to auxiliary windows", () => {
  withSecurity(({ assertTrustedIpcSender }) => {
    const { event, manager, sender } = fixture();
    manager.notificationWindow = { name: "notification" };
    sender._window = manager.notificationWindow;
    assert.throws(
      () => assertTrustedIpcSender(event, "get-openai-key", manager),
      { code: "IPC_CAPABILITY_FORBIDDEN" }
    );
  });
});
