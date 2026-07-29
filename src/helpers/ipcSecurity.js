const { BrowserWindow } = require("electron");
const { isAllowedRendererUrl } = require("./windowSecurity");

const CONTROL_PANEL_ONLY = [
  /^auth-(?:start-browser|refresh-session|logout|delete-account)$/,
  /^(?:check-for-updates|download-update|install-update)$/,
  /^workspace-api-request$/,
  /^save-.*(?:key|secret|token|credential)/,
  /^save-all-keys-to-env$/,
];

const MAIN_OR_CONTROL = [
  /^get-.*(?:key|secret|token|credential)/,
];

function assertTrustedIpcSender(event, channel, windowManager) {
  if (!event?.sender || event.sender.isDestroyed()) {
    const error = new Error("IPC sender is unavailable");
    error.code = "IPC_SENDER_INVALID";
    throw error;
  }
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    const error = new Error("IPC is only available to the top-level application frame");
    error.code = "IPC_SUBFRAME_FORBIDDEN";
    throw error;
  }
  if (!isAllowedRendererUrl(event.senderFrame.url)) {
    const error = new Error("IPC sender URL is not trusted");
    error.code = "IPC_ORIGIN_FORBIDDEN";
    throw error;
  }

  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const knownWindows = [
    windowManager?.mainWindow,
    windowManager?.controlPanelWindow,
    windowManager?.agentWindow,
    windowManager?.notificationWindow,
    windowManager?.transcriptionPreviewWindow,
    windowManager?.updateNotificationWindow,
  ].filter(Boolean);
  if (!senderWindow || !knownWindows.includes(senderWindow)) {
    const error = new Error("IPC sender window is not registered");
    error.code = "IPC_WINDOW_FORBIDDEN";
    throw error;
  }

  if (
    CONTROL_PANEL_ONLY.some((pattern) => pattern.test(channel)) &&
    senderWindow !== windowManager?.controlPanelWindow
  ) {
    const error = new Error("IPC capability is restricted to the control panel");
    error.code = "IPC_CAPABILITY_FORBIDDEN";
    throw error;
  }
  if (
    MAIN_OR_CONTROL.some((pattern) => pattern.test(channel))
    && ![windowManager?.mainWindow, windowManager?.controlPanelWindow].includes(senderWindow)
  ) {
    const error = new Error("IPC capability is restricted to application windows");
    error.code = "IPC_CAPABILITY_FORBIDDEN";
    throw error;
  }
}

function createSecureHandler(ipcMain, windowManager) {
  return (channel, handler) => {
    if (typeof channel !== "string" || typeof handler !== "function") {
      throw new TypeError("Invalid IPC handler registration");
    }
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedIpcSender(event, channel, windowManager);
      return handler(event, ...args);
    });
  };
}

module.exports = { assertTrustedIpcSender, createSecureHandler };
